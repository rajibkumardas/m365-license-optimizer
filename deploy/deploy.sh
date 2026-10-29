#!/usr/bin/env bash
# =====================================================================
# M365 License Optimizer - Azure deployment (run in Azure Cloud Shell, Bash)
#
# Usage:  ./deploy/deploy.sh <phase>     (or run ./setup.sh, the guided wizard, first)
#   preflight Checks tools, sign-in and permissions. Changes nothing.
#   all      Runs preflight, infra, auth, graph and upgrade in order.
#   infra    Resource group, ACR (build image), Linux plan, Web App,
#            managed identity + AcrPull, health check. Starts in mock mode.
#   (run order: infra -> auth -> graph)
#   graph    Graph reader app registration (Organization.Read.All,
#            Directory.Read.All, Reports.Read.All), admin consent,
#            Key Vault + secret, Key Vault reference, DATA_MODE=live.
#   auth     Sign-in app registration, SG-LicenseOptimizer-Users group,
#            assignment required, App Service Authentication (Easy Auth).
#   upgrade  v2 features: renewal actions, forecast, reminders. Storage account
#            (settings/audit/reminder ledger), LicenseAssignment.ReadWrite.All,
#            app roles + SG-LicenseOptimizer-Admins, delegated Azure Service
#            Management sign-in scope + token store, Always On, image v2.
#            Then run deploy/Set-MailSendScope.ps1 for the reminder mailbox.
#   image    Rebuild the image from this folder (NEW_TAG=<tag>, default is a timestamp)
#            and switch the app to it. Use for code-only updates; changes nothing else.
#   status   Print names, URL and current settings (no changes).
#   rollback Print the rollback commands (does NOT run them).
#
# Requirements:
#   - Azure: Owner (or Contributor + User Access Administrator) on the
#     subscription, because the script creates role assignments.
#   - Entra: Global Administrator (activate via PIM) for the graph and
#     auth phases (app registrations, admin consent, group assignment).
# Settings and generated names persist in ~/.licopt.env (written by setup.sh or by
# this script) so phases can be re-run safely. Override any of them with env vars.
# =====================================================================
set -euo pipefail

# Always run from the repository root (the Docker build context lives there).
cd "$(dirname "${BASH_SOURCE[0]}")/.."

STATE=${LICOPT_STATE:-$HOME/.licopt.env}
[[ -f $STATE ]] && source "$STATE"

# Organization-specific settings (written by setup.sh; defaults are neutral)
ORG_NAME=${ORG_NAME:-}                       # label shown in the dashboard for a single tenant
CURRENCY=${CURRENCY:-USD}                    # ISO 4217 code used for display
INACTIVITY_DAYS=${INACTIVITY_DAYS:-90}
REMINDER_SENDER=${REMINDER_SENDER:-}         # shared mailbox that sends renewal reminders (optional)
REMINDER_TIMEZONE=${REMINDER_TIMEZONE:-UTC}  # IANA zone for the daily reminder run hour
PLAN_SKU=${PLAN_SKU:-B1}                     # Basic or higher is required for Always On

RG=${RG:-rg-license-optimizer}
LOC=${LOC:-eastus}
SUFFIX=${SUFFIX:-$(printf "%05d" $((RANDOM % 100000)))}
ACR=${ACR:-acrlicopt$SUFFIX}
PLAN=${PLAN:-asp-license-optimizer}
APP=${APP:-app-licopt-$SUFFIX}
KV=${KV:-kv-licopt-$SUFFIX}
IMAGE=m365-license-optimizer
TAG=${TAG:-v1}
ST=${ST:-stlicopt$SUFFIX}
ADMIN_GROUP_NAME=${ADMIN_GROUP_NAME:-SG-LicenseOptimizer-Admins}
ARM_API=797f4846-ba00-4fd7-ba43-dac1f8f63013   # Windows Azure Service Management API
GROUP_NAME=${GROUP_NAME:-SG-LicenseOptimizer-Users}
TID=$(az account show --query tenantId -o tsv)
GRAPH_API=00000003-0000-0000-c000-000000000000

save() {
  umask 077
  {
    for V in ORG_NAME CURRENCY INACTIVITY_DAYS REMINDER_SENDER REMINDER_TIMEZONE PLAN_SKU \
             RG LOC SUFFIX ACR PLAN APP KV TAG GROUP_NAME ADMIN_GROUP_NAME \
             GRAPH_APP_ID SIGNIN_APP_ID GROUP_ID ADMIN_GROUP_ID ST; do
      printf '%s=%q\n' "$V" "${!V:-}"
    done
  } >"$STATE"
}
save
log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

phase_preflight() {
  local OK=true
  log "Preflight checks (nothing is changed)"
  for T in az jq; do
    if command -v "$T" >/dev/null; then echo "  ok   $T found"; else echo "  FAIL $T not found"; OK=false; fi
  done
  if ! az account show -o none 2>/dev/null; then echo "  FAIL not signed in: run 'az login'"; return 1; fi
  echo "  ok   signed in: $(az account show --query '[user.name,name]' -o tsv | tr '\t' ' ')"
  echo "  ok   tenant: $TID"
  local ME SUB ROLES DIRROLES
  ME=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
  SUB=$(az account show --query id -o tsv)
  if [[ -n $ME ]]; then
    ROLES=$(az role assignment list --assignee "$ME" --scope "/subscriptions/$SUB" --include-inherited \
      --query "[].roleDefinitionName" -o tsv 2>/dev/null || true)
    if grep -qxE "Owner|User Access Administrator" <<<"$ROLES"; then
      echo "  ok   Azure role allows role assignments (Owner or User Access Administrator)"
    else
      echo "  WARN no Owner or User Access Administrator role found on the subscription; the infra phase creates role assignments"
    fi
    DIRROLES=$(az rest --method GET \
      --url 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.directoryRole' \
      --query "value[].displayName" -o tsv 2>/dev/null || true)
    if grep -qxE "Global Administrator|Privileged Role Administrator" <<<"$DIRROLES"; then
      echo "  ok   Entra role active: $(grep -xE 'Global Administrator|Privileged Role Administrator' <<<"$DIRROLES" | paste -sd, -)"
    else
      echo "  WARN Global Administrator (or Privileged Role Administrator) is not active; the auth and graph phases need it (activate it in PIM if eligible)"
    fi
  fi
  if [[ -f Dockerfile ]]; then echo "  ok   Dockerfile found in $(pwd)"; else echo "  FAIL run from the repository (Dockerfile not found)"; OK=false; fi
  echo "  note App Service Authentication group assignment needs Entra ID P1 or higher."
  [[ $OK == true ]]
}

phase_infra() {
  log "Subscription: $(az account show --query '[name,id]' -o tsv | tr '\t' ' ')"
  log "Registering resource providers (one-time per subscription)"
  for NS in Microsoft.ContainerRegistry Microsoft.Web Microsoft.KeyVault; do
    az provider register --namespace "$NS" --wait -o none
  done
  log "Resource group $RG ($LOC)"
  az group create -n "$RG" -l "$LOC" -o none

  log "Container registry $ACR"
  az acr create -g "$RG" -n "$ACR" --sku Basic -o none

  log "Building image in ACR (az acr build, no local Docker needed)"
  az acr build -r "$ACR" -t "$IMAGE:$TAG" .

  log "App Service plan $PLAN (Linux $PLAN_SKU)"
  az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku "$PLAN_SKU" -o none

  log "Web App $APP"
  az webapp create -g "$RG" -p "$PLAN" -n "$APP" \
    --container-image-name "$ACR.azurecr.io/$IMAGE:$TAG" -o none

  log "Managed identity + AcrPull"
  PRINCIPAL=$(az webapp identity assign -g "$RG" -n "$APP" --query principalId -o tsv)
  ACR_ID=$(az acr show -g "$RG" -n "$ACR" --query id -o tsv)
  az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
    --scope "$ACR_ID" --role AcrPull -o none
  az webapp config set -g "$RG" -n "$APP" \
    --generic-configurations '{"acrUseManagedIdentityCreds": true, "healthCheckPath": "/api/health"}' -o none
  az webapp update -g "$RG" -n "$APP" --https-only true -o none

  log "App settings (mock mode until the graph phase)"
  az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
    WEBSITES_PORT=8080 DATA_MODE=mock "CURRENCY=$CURRENCY" "INACTIVITY_DAYS=$INACTIVITY_DAYS" \
    "TENANT_DISPLAY_NAME=${ORG_NAME:-Primary tenant}" "REMINDER_TIMEZONE=$REMINDER_TIMEZONE"

  az webapp restart -g "$RG" -n "$APP"
  log "Done. URL: https://$APP.azurewebsites.net  (first container pull can take 2-4 minutes)"
}

ensure_kv() {
  if az keyvault show -n "$KV" -o none 2>/dev/null; then return; fi
  log "Key Vault $KV (RBAC mode)"
  az keyvault create -g "$RG" -n "$KV" -l "$LOC" --enable-rbac-authorization true -o none
  KV_ID=$(az keyvault show -n "$KV" --query id -o tsv)
  ME=$(az ad signed-in-user show --query id -o tsv)
  az role assignment create --assignee-object-id "$ME" --assignee-principal-type User \
    --role "Key Vault Secrets Officer" --scope "$KV_ID" -o none
  PRINCIPAL=$(az webapp identity show -g "$RG" -n "$APP" --query principalId -o tsv)
  az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Secrets User" --scope "$KV_ID" -o none
  log "Waiting 60s for RBAC propagation"
  sleep 60
}

phase_graph() {
  log "Graph reader app registration"
  GRAPH_APP_ID=$(az ad app list --display-name "M365 License Optimizer - Graph Reader" --query '[0].appId' -o tsv)
  if [[ -z $GRAPH_APP_ID ]]; then
    GRAPH_APP_ID=$(az ad app create --display-name "M365 License Optimizer - Graph Reader" \
      --sign-in-audience AzureADMyOrg --query appId -o tsv)
  fi
  save
  az ad sp show --id "$GRAPH_APP_ID" -o none 2>/dev/null || az ad sp create --id "$GRAPH_APP_ID" -o none

  log "Adding application permissions (resolved from the Graph service principal, not hardcoded)"
  for P in Organization.Read.All Directory.Read.All Reports.Read.All; do
    RID=$(az ad sp show --id $GRAPH_API --query "appRoles[?value=='$P'].id | [0]" -o tsv)
    az ad app permission add --id "$GRAPH_APP_ID" --api $GRAPH_API --api-permissions "$RID=Role" -o none 2>/dev/null || true
    echo "  $P -> $RID"
  done

  log "Granting admin consent via appRoleAssignedTo (needs Global Admin or Privileged Role Admin active)"
  # 'az ad app permission admin-consent' fails in Cloud Shell (portal-only token audience),
  # so assign the Graph app roles to our service principal directly.
  GRAPH_SP=$(az ad sp show --id $GRAPH_API --query id -o tsv)
  OUR_SP=$(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv)
  EXISTING=$(az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/$OUR_SP/appRoleAssignments" \
    --query "value[].appRoleId" -o tsv 2>/dev/null || true)
  CONSENT_OK=true
  for P in Organization.Read.All Directory.Read.All Reports.Read.All; do
    RID=$(az ad sp show --id $GRAPH_API --query "appRoles[?value=='$P'].id | [0]" -o tsv)
    if grep -q "$RID" <<<"$EXISTING"; then echo "  $P already granted"; continue; fi
    if az rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/$GRAPH_SP/appRoleAssignedTo" \
         --headers "Content-Type=application/json" \
         --body "{\"principalId\":\"$OUR_SP\",\"resourceId\":\"$GRAPH_SP\",\"appRoleId\":\"$RID\"}" -o none; then
      echo "  $P granted"
    else
      CONSENT_OK=false
    fi
  done
  if [[ $CONSENT_OK != true ]]; then
    echo
    echo "Could not grant consent from Cloud Shell. Grant it in the portal instead, then re-run: ./deploy/deploy.sh graph"
    echo "  Entra admin center > App registrations > All applications > M365 License Optimizer - Graph Reader"
    echo "  > API permissions > Grant admin consent for <tenant>"
    return 1
  fi

  ensure_kv

  if az keyvault secret show --vault-name "$KV" -n graph-client-secret -o none 2>/dev/null; then
    log "Graph client secret already in Key Vault; keeping it"
  else
  log "Creating client secret (1 year) straight into Key Vault; it is never printed"
  SECRET=$(az ad app credential reset --id "$GRAPH_APP_ID" --display-name "licopt-$(date +%Y%m%d)" \
    --years 1 --query password -o tsv 2>/dev/null)
  az keyvault secret set --vault-name "$KV" -n graph-client-secret --value "$SECRET" -o none
  unset SECRET
  fi

  AUTH_ON=$(az webapp auth show -g "$RG" -n "$APP" --query "properties.platform.enabled || enabled" -o tsv 2>/dev/null || echo false)
  if [[ "$AUTH_ON" != "true" ]]; then
    echo "App Service Authentication is OFF. Run the auth phase first; staying in mock mode."; return 1
  fi
  log "Switching the app to live mode"
  az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
    DATA_MODE=live AZURE_TENANT_ID="$TID" CLIENT_ID="$GRAPH_APP_ID" \
    "CLIENT_SECRET=@Microsoft.KeyVault(VaultName=$KV;SecretName=graph-client-secret)"
  az webapp restart -g "$RG" -n "$APP"
  log "Done. Secret expires in 1 year: set a reminder to rotate it."
}

phase_auth() {
  REDIRECT="https://$APP.azurewebsites.net/.auth/login/aad/callback"
  log "Sign-in app registration"
  SIGNIN_APP_ID=$(az ad app list --display-name "M365 License Optimizer - Sign-in" --query '[0].appId' -o tsv)
  if [[ -z $SIGNIN_APP_ID ]]; then
    SIGNIN_APP_ID=$(az ad app create --display-name "M365 License Optimizer - Sign-in" \
      --sign-in-audience AzureADMyOrg --web-redirect-uris "$REDIRECT" \
      --enable-id-token-issuance true --query appId -o tsv)
  fi
  save
  az ad sp show --id "$SIGNIN_APP_ID" -o none 2>/dev/null || az ad sp create --id "$SIGNIN_APP_ID" -o none
  SP_OID=$(az ad sp show --id "$SIGNIN_APP_ID" --query id -o tsv)

  log "Requiring user assignment on the enterprise app"
  az ad sp update --id "$SIGNIN_APP_ID" --set appRoleAssignmentRequired=true

  log "Group $GROUP_NAME"
  GROUP_ID=$(az ad group list --display-name "$GROUP_NAME" --query '[0].id' -o tsv)
  if [[ -z $GROUP_ID ]]; then
    GROUP_ID=$(az ad group create --display-name "$GROUP_NAME" --mail-nickname "${GROUP_NAME//-/}" \
      --description "Access to the M365 License Optimizer dashboard" --query id -o tsv)
  fi
  save
  ME=$(az ad signed-in-user show --query id -o tsv)
  az ad group member check --group "$GROUP_ID" --member-id "$ME" --query value -o tsv | grep -q true \
    || az ad group member add --group "$GROUP_ID" --member-id "$ME"

  log "Assigning the group to the sign-in app (requires Entra ID P1)"
  ASSIGNED=$(az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_OID/appRoleAssignedTo" \
    --query "value[?principalId=='$GROUP_ID'] | length(@)" -o tsv)
  if [[ "$ASSIGNED" == "0" ]]; then
    az rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_OID/appRoleAssignedTo" \
      --headers "Content-Type=application/json" \
      --body "{\"principalId\":\"$GROUP_ID\",\"resourceId\":\"$SP_OID\",\"appRoleId\":\"00000000-0000-0000-0000-000000000000\"}" -o none
    echo "  group assigned"
  else
    echo "  group already assigned"
  fi

  ensure_kv
  if az keyvault secret show --vault-name "$KV" -n easyauth-client-secret -o none 2>/dev/null; then
    log "Sign-in client secret already in Key Vault; keeping it"
  else
    log "Sign-in client secret into Key Vault"
    SECRET=$(az ad app credential reset --id "$SIGNIN_APP_ID" --display-name "easyauth-$(date +%Y%m%d)" \
      --years 1 --query password -o tsv 2>/dev/null)
    az keyvault secret set --vault-name "$KV" -n easyauth-client-secret --value "$SECRET" -o none
    unset SECRET
  fi
  az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
    "MICROSOFT_PROVIDER_AUTHENTICATION_SECRET=@Microsoft.KeyVault(VaultName=$KV;SecretName=easyauth-client-secret)"

  log "Enabling App Service Authentication"
  az extension add --name authV2 --upgrade -y -o none 2>/dev/null || true
  # New Web Apps start on classic (v1) auth settings; v2 commands refuse to run until upgraded.
  az webapp auth config-version upgrade -g "$RG" -n "$APP" -o none 2>/dev/null || true
  az webapp auth microsoft update -g "$RG" -n "$APP" --client-id "$SIGNIN_APP_ID" \
    --client-secret-setting-name MICROSOFT_PROVIDER_AUTHENTICATION_SECRET \
    --issuer "https://login.microsoftonline.com/$TID/v2.0" --yes -o none
  az webapp auth update -g "$RG" -n "$APP" --enabled true \
    --unauthenticated-client-action RedirectToLoginPage --redirect-provider azureactivedirectory -o none
  log "Done. Only members of $GROUP_NAME can sign in. Add others with:"
  echo "  az ad group member add --group $GROUP_ID --member-id <userObjectId>"
}

grant_graph_app_roles() { # $1 = client appId, rest = permission values
  local APPID=$1; shift
  local GRAPH_SP OUR_SP EXISTING RID
  GRAPH_SP=$(az ad sp show --id $GRAPH_API --query id -o tsv)
  OUR_SP=$(az ad sp show --id "$APPID" --query id -o tsv)
  EXISTING=$(az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$OUR_SP/appRoleAssignments" \
    --query "value[].appRoleId" -o tsv 2>/dev/null || true)
  for P in "$@"; do
    RID=$(az ad sp show --id $GRAPH_API --query "appRoles[?value=='$P'].id | [0]" -o tsv)
    az ad app permission add --id "$APPID" --api $GRAPH_API --api-permissions "$RID=Role" -o none 2>/dev/null || true
    if grep -q "$RID" <<<"$EXISTING"; then echo "  $P already granted"; continue; fi
    az rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/$GRAPH_SP/appRoleAssignedTo" \
      --headers "Content-Type=application/json" \
      --body "{\"principalId\":\"$OUR_SP\",\"resourceId\":\"$GRAPH_SP\",\"appRoleId\":\"$RID\"}" -o none
    echo "  $P granted"
  done
}

assign_app_role() { # $1 sign-in SP object id, $2 group id, $3 app role id
  local N
  N=$(az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$1/appRoleAssignedTo" \
    --query "value[?principalId=='$2' && appRoleId=='$3'] | length(@)" -o tsv)
  if [[ "$N" != "0" ]]; then echo "  already assigned"; return; fi
  az rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/$1/appRoleAssignedTo" \
    --headers "Content-Type=application/json" \
    --body "{\"principalId\":\"$2\",\"resourceId\":\"$1\",\"appRoleId\":\"$3\"}" -o none
  echo "  assigned"
}

phase_upgrade() {
  GRAPH_APP_ID=${GRAPH_APP_ID:-$(az ad app list --display-name "M365 License Optimizer - Graph Reader" --query '[0].appId' -o tsv)}
  SIGNIN_APP_ID=${SIGNIN_APP_ID:-$(az ad app list --display-name "M365 License Optimizer - Sign-in" --query '[0].appId' -o tsv)}
  GROUP_ID=${GROUP_ID:-$(az ad group list --display-name "$GROUP_NAME" --query '[0].id' -o tsv)}
  if [[ -z $GRAPH_APP_ID || -z $SIGNIN_APP_ID || -z $GROUP_ID ]]; then echo "Run the auth and graph phases first."; return 1; fi
  PRINCIPAL=$(az webapp identity show -g "$RG" -n "$APP" --query principalId -o tsv)
  ME=$(az ad signed-in-user show --query id -o tsv)

  log "Storage account $ST (Table Storage for settings, audit log, reminder ledger; shared keys disabled)"
  if ! az storage account show -g "$RG" -n "$ST" -o none 2>/dev/null; then
    az provider register --namespace Microsoft.Storage --wait -o none
    az storage account create -g "$RG" -n "$ST" -l "$LOC" --sku Standard_LRS --kind StorageV2 \
      --min-tls-version TLS1_2 --allow-blob-public-access false --allow-shared-key-access false -o none
  fi
  ST_ID=$(az storage account show -g "$RG" -n "$ST" --query id -o tsv)
  az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
    --role "Storage Table Data Contributor" --scope "$ST_ID" -o none
  save

  log "Graph app: add LicenseAssignment.ReadWrite.All (remove-license action)"
  grant_graph_app_roles "$GRAPH_APP_ID" LicenseAssignment.ReadWrite.All

  log "Sign-in app: app roles LicenseOptimizer.Admin / LicenseOptimizer.Reader"
  HAS_ROLES=$(az ad app show --id "$SIGNIN_APP_ID" --query "length(appRoles[?value=='LicenseOptimizer.Admin'])" -o tsv)
  if [[ "$HAS_ROLES" == "0" ]]; then
    printf '[{"allowedMemberTypes":["User"],"description":"Run license and billing actions, change settings","displayName":"License Optimizer Admin","isEnabled":true,"value":"LicenseOptimizer.Admin","id":"%s"},{"allowedMemberTypes":["User"],"description":"View dashboards (read-only)","displayName":"License Optimizer Reader","isEnabled":true,"value":"LicenseOptimizer.Reader","id":"%s"}]' \
      "$(cat /proc/sys/kernel/random/uuid)" "$(cat /proc/sys/kernel/random/uuid)" > /tmp/licopt-roles.json
    az ad app update --id "$SIGNIN_APP_ID" --app-roles @/tmp/licopt-roles.json
    sleep 20
  fi
  ADMIN_ROLE_ID=$(az ad app show --id "$SIGNIN_APP_ID" --query "appRoles[?value=='LicenseOptimizer.Admin'].id | [0]" -o tsv)
  READER_ROLE_ID=$(az ad app show --id "$SIGNIN_APP_ID" --query "appRoles[?value=='LicenseOptimizer.Reader'].id | [0]" -o tsv)
  SP_OID=$(az ad sp show --id "$SIGNIN_APP_ID" --query id -o tsv)

  log "Group $ADMIN_GROUP_NAME (you are added as the first member)"
  ADMIN_GROUP_ID=$(az ad group list --display-name "$ADMIN_GROUP_NAME" --query '[0].id' -o tsv)
  if [[ -z $ADMIN_GROUP_ID ]]; then
    ADMIN_GROUP_ID=$(az ad group create --display-name "$ADMIN_GROUP_NAME" --mail-nickname "${ADMIN_GROUP_NAME//-/}" \
      --description "License Optimizer admins: may change licenses, seats and auto-renew" --query id -o tsv)
  fi
  save
  az ad group member check --group "$ADMIN_GROUP_ID" --member-id "$ME" --query value -o tsv | grep -q true \
    || az ad group member add --group "$ADMIN_GROUP_ID" --member-id "$ME"
  echo " Admins group -> Admin role:"; assign_app_role "$SP_OID" "$ADMIN_GROUP_ID" "$ADMIN_ROLE_ID"
  echo " Users group  -> Reader role:"; assign_app_role "$SP_OID" "$GROUP_ID" "$READER_ROLE_ID"

  log "Sign-in app: delegated scopes (sign-in basics + Azure Service Management user_impersonation)"
  for P in openid profile email offline_access User.Read; do
    PID=$(az ad sp show --id $GRAPH_API --query "oauth2PermissionScopes[?value=='$P'].id | [0]" -o tsv)
    az ad app permission add --id "$SIGNIN_APP_ID" --api $GRAPH_API --api-permissions "$PID=Scope" -o none 2>/dev/null || true
  done
  ARM_SCOPE=$(az ad sp show --id $ARM_API --query "oauth2PermissionScopes[?value=='user_impersonation'].id | [0]" -o tsv)
  az ad app permission add --id "$SIGNIN_APP_ID" --api $ARM_API --api-permissions "$ARM_SCOPE=Scope" -o none 2>/dev/null || true
  az ad app permission grant --id "$SIGNIN_APP_ID" --api $GRAPH_API --scope "openid profile email offline_access User.Read" -o none
  az ad app permission grant --id "$SIGNIN_APP_ID" --api $ARM_API --scope "user_impersonation" -o none
  echo "  consented (delegated: the app can only do what each signed-in admin's own billing role allows)"

  log "App Service Authentication: token store + request an Azure Resource Manager token at sign-in"
  APP_RID=$(az webapp show -g "$RG" -n "$APP" --query id -o tsv)
  AUTH_URL="https://management.azure.com${APP_RID}/config/authsettingsV2?api-version=2023-01-01"
  az rest --method GET --url "$AUTH_URL" -o json > /tmp/licopt-auth.json
  jq '.properties.login.tokenStore.enabled = true
      | .properties.identityProviders.azureActiveDirectory.login.loginParameters =
          ["scope=openid profile email offline_access https://management.azure.com/user_impersonation"]
      | {properties: .properties}' /tmp/licopt-auth.json > /tmp/licopt-auth-new.json
  az rest --method PUT --url "$AUTH_URL" --body @/tmp/licopt-auth-new.json -o none
  echo "  done (sign out and back in once to get the billing token)"

  log "App settings + Always On (keeps the daily reminder scheduler alive)"
  AUTH_ON=$(az webapp auth show -g "$RG" -n "$APP" --query "properties.platform.enabled || enabled" -o tsv 2>/dev/null || echo false)
  if [[ "$AUTH_ON" != "true" ]]; then echo "App Service Authentication is OFF; refusing to continue."; return 1; fi
  az webapp config set -g "$RG" -n "$APP" --always-on true -o none
  az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings EASY_AUTH_ENABLED=true \
    STORAGE_ACCOUNT_NAME="$ST" ENABLE_SCHEDULER=true "REMINDER_SENDER=$REMINDER_SENDER" \
    APP_BASE_URL="https://$APP.azurewebsites.net"

  log "Building image v2 and switching the app to it"
  TAG=v2
  save
  az acr build -r "$ACR" -t "$IMAGE:$TAG" .
  az webapp config container set -g "$RG" -n "$APP" --container-image-name "$ACR.azurecr.io/$IMAGE:$TAG" -o none
  az webapp restart -g "$RG" -n "$APP"

  log "Done."
  if [[ -n $REMINDER_SENDER ]]; then
    echo "Remaining manual step for reminder emails (Exchange Online, PowerShell; see README):"
    echo "  pwsh ./deploy/Set-MailSendScope.ps1 -AppId $GRAPH_APP_ID -ServicePrincipalObjectId $(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv) -Mailbox $REMINDER_SENDER"
  else
    echo "No reminder mailbox configured. To enable reminders later, set REMINDER_SENDER, re-run the upgrade phase and run deploy/Set-MailSendScope.ps1."
  fi
}

phase_image() {
  local NEW_TAG=${NEW_TAG:-v$(date +%Y%m%d%H%M)}
  log "Building image $NEW_TAG and switching $APP to it"
  az acr build -r "$ACR" -t "$IMAGE:$NEW_TAG" .
  az webapp config container set -g "$RG" -n "$APP" --container-image-name "$ACR.azurecr.io/$IMAGE:$NEW_TAG" -o none
  az webapp restart -g "$RG" -n "$APP"
  TAG=$NEW_TAG; save
  log "Done. Rollback: NEW_TAG=<previous tag> ./deploy/deploy.sh image"
}

phase_status() {
  log "Names"; cat "$STATE"
  log "App Service Authentication enabled:"
  az webapp auth show -g "$RG" -n "$APP" --query "properties.platform.enabled || enabled" -o tsv 2>/dev/null || echo "unknown"
  if [[ -n ${GRAPH_APP_ID:-} ]]; then
    log "Graph app roles granted to the Graph Reader app:"
    OUR_SP=$(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv)
    az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$OUR_SP/appRoleAssignments" \
      --query "value[].appRoleId" -o tsv
  fi
  log "URL: https://$APP.azurewebsites.net"
  az webapp show -g "$RG" -n "$APP" --query '{state:state, image:siteConfig.linuxFxVersion}' -o table 2>/dev/null || true
  az webapp config appsettings list -g "$RG" -n "$APP" \
    --query "[?name!='CLIENT_SECRET' && name!='MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'].{name:name,value:value}" -o table 2>/dev/null || true
}

phase_rollback() {
  cat <<EOF
# Review, then run manually. Deletes everything this script created.
az group delete -n $RG --yes            # Web App, plan, ACR, Key Vault (soft-deleted)
az keyvault purge -n $KV                # optional: frees the vault name
az ad app delete --id ${GRAPH_APP_ID:-<graph-app-id>}
az ad app delete --id ${SIGNIN_APP_ID:-<signin-app-id>}
az ad group delete --group ${GROUP_ID:-<group-id>}
az ad group delete --group ${ADMIN_GROUP_ID:-<admin-group-id>}
az storage account delete -g $RG -n $ST --yes   # included in the RG delete above
# Exchange (PowerShell): Remove-ManagementRoleAssignment, Remove-ManagementScope "LicenseOptimizer-Sender", Remove-ServicePrincipal
rm ~/.licopt.env
EOF
}

phase_all() {
  phase_preflight
  phase_infra
  phase_auth
  phase_graph
  phase_upgrade
}

case "${1:-}" in
  preflight) phase_preflight ;;
  all) phase_all ;;
  infra) phase_infra ;;
  graph) phase_graph ;;
  auth) phase_auth ;;
  upgrade) phase_upgrade ;;
  image) phase_image ;;
  status) phase_status ;;
  rollback) phase_rollback ;;
  *) sed -n '3,34p' "$0"; exit 1 ;;
esac
