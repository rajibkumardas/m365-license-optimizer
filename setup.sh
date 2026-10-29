#!/usr/bin/env bash
# =====================================================================
# M365 License Optimizer - setup wizard
#
# Run in Azure Cloud Shell (Bash) from the repository root:
#     ./setup.sh
#
# The wizard asks a few questions about YOUR organization, saves the answers
# to ~/.licopt.env (no secrets), then runs the deployment phases in
# deploy/deploy.sh for you. Nothing in Azure or Entra ID is changed until you
# confirm the summary.
#
# Options
#   --config FILE   load answers from a KEY=VALUE file (see deploy/example.conf)
#   --yes           do not prompt: use --config / environment values and defaults
#   --configure     only save the configuration; do not offer to deploy
#   --phases LIST   after saving, run these phases without asking
#                   (preflight, all, infra, auth, graph, upgrade, image, status)
#   --help          show this text
# =====================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
STATE=${LICOPT_STATE:-$HOME/.licopt.env}

CONFIG_FILE=""; ASSUME_YES=false; CONFIGURE_ONLY=false; PHASES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE=${2:?--config needs a file}; shift 2 ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    --configure) CONFIGURE_ONLY=true; shift ;;
    --phases) PHASES=${2:?--phases needs a list}; shift 2 ;;
    --help|-h) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
done

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33mWARN: %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*"; exit 1; }

# Load previous answers first, then an explicit config file (which wins).
# shellcheck disable=SC1090
[[ -f $STATE ]] && source "$STATE"
if [[ -n $CONFIG_FILE ]]; then
  [[ -f $CONFIG_FILE ]] || fail "Config file not found: $CONFIG_FILE"
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

HAVE_AZ=false; command -v az >/dev/null 2>&1 && HAVE_AZ=true

# ---------- prompt helpers ----------
# ask VAR "Question" "default" [validator-function] [help text]
ask() {
  local var=$1 q=$2 def=$3 validator=${4:-} help=${5:-} cur reply
  cur=${!var:-$def}
  while true; do
    if [[ $ASSUME_YES == true ]]; then
      reply=$cur
    else
      [[ -n $help ]] && printf '  \033[2m%s\033[0m\n' "$help"
      read -r -p "$q [${cur:-none}]: " reply || reply=""
      reply=${reply:-$cur}
      [[ $reply == "-" ]] && reply=""
    fi
    if [[ -z $validator ]] || $validator "$reply"; then
      printf -v "$var" '%s' "$reply"; return 0
    fi
    [[ $ASSUME_YES == true ]] && fail "Invalid value for $var: '$reply'"
    warn "That value is not valid; try again."
  done
}

ask_yn() { # ask_yn "Question" default(y/n)
  local q=$1 def=${2:-y} reply
  if [[ $ASSUME_YES == true ]]; then [[ $def == y ]]; return; fi
  read -r -p "$q [$([[ $def == y ]] && echo Y/n || echo y/N)]: " reply || reply=""
  reply=${reply:-$def}
  [[ $reply =~ ^[Yy] ]]
}

# ---------- validators ----------
v_nonempty() { [[ -n $1 ]]; }
v_currency() { [[ $1 =~ ^[A-Za-z]{3}$ ]]; }
v_days()     { [[ $1 =~ ^[0-9]+$ && $1 -ge 7 && $1 -le 365 ]]; }
v_suffix()   { [[ $1 =~ ^[a-z0-9]{3,8}$ ]]; }
v_rg()       { [[ $1 =~ ^[A-Za-z0-9._()-]{1,90}$ && ! $1 =~ \.$ ]]; }
v_group()    { [[ $1 =~ ^[A-Za-z0-9._-]{1,60}$ ]]; }
v_email_opt(){ [[ -z $1 || $1 =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }
v_plan()     { [[ $1 =~ ^(B1|B2|B3|S1|S2|S3|P1V3|P2V3|P3V3)$ ]]; }
v_tz() {
  [[ $1 == UTC ]] && return 0
  [[ $1 =~ ^[A-Za-z_]+(/[A-Za-z_+-]+){1,2}$ ]] || return 1
  [[ ! -d /usr/share/zoneinfo || -e /usr/share/zoneinfo/$1 ]]
}
v_region() {
  [[ $1 =~ ^[a-z0-9]{3,30}$ ]] || return 1
  if [[ $HAVE_AZ == true && -n ${REGIONS_CACHE:-} ]]; then grep -qx "$1" <<<"$REGIONS_CACHE"; fi
}

# ---------- welcome ----------
if [[ $ASSUME_YES != true ]]; then
  bold "M365 License Optimizer - setup wizard"
  cat <<'TXT'

This wizard collects the settings for your organization and then deploys the
dashboard to Azure App Service in your own subscription. It takes about 15
minutes. Press Enter to accept the value in [brackets]; type - to clear a value.

What it will create (only after you confirm):
  - a resource group, container registry, App Service plan and Web App
  - a Key Vault and a storage account (settings, audit log)
  - two Entra app registrations and two access groups
It starts in demo (mock) mode and switches to live Microsoft Graph data in the
"graph" phase. Nothing is sent outside your tenant.

TXT
fi

# ---------- environment checks ----------
if [[ $HAVE_AZ == true ]]; then
  if ! az account show -o none 2>/dev/null; then
    fail "Not signed in to Azure. Run 'az login' (or open Azure Cloud Shell), then run ./setup.sh again."
  fi
  info "Signed in as $(az account show --query user.name -o tsv) | tenant $(az account show --query tenantId -o tsv)"
  if [[ $ASSUME_YES != true ]]; then
    SUBS=$(az account list --query "[?state=='Enabled'].[name,id]" -o tsv 2>/dev/null || true)
    if [[ $(wc -l <<<"$SUBS") -gt 1 ]]; then
      echo; bold "Subscriptions you can use:"; nl -w2 -s'. ' <<<"$SUBS" | sed 's/\t/  /'
      echo "Current: $(az account show --query '[name,id]' -o tsv | tr '\t' ' ')"
      read -r -p "Enter a subscription ID or name to switch, or press Enter to keep the current one: " SUBPICK || SUBPICK=""
      [[ -n $SUBPICK ]] && az account set --subscription "$SUBPICK"
    fi
  fi
  REGIONS_CACHE=$(az account list-locations --query "[?metadata.regionType=='Physical'].name" -o tsv 2>/dev/null || true)
else
  warn "The Azure CLI ('az') was not found. The wizard can still save your settings; run the deployment from Azure Cloud Shell."
fi

# ---------- defaults discovered from the tenant ----------
DEF_ORG=""; DEF_DOMAIN=""
if [[ $HAVE_AZ == true ]]; then
  DEF_ORG=$(az rest --method GET --url "https://graph.microsoft.com/v1.0/organization" \
    --query "value[0].displayName" -o tsv 2>/dev/null || true)
  DEF_DOMAIN=$(az rest --method GET --url "https://graph.microsoft.com/v1.0/organization" \
    --query "value[0].verifiedDomains[?isDefault].name | [0]" -o tsv 2>/dev/null || true)
fi

# ---------- questions ----------
[[ $ASSUME_YES == true ]] || { echo; bold "1. Your organization"; }
ask ORG_NAME "Organization name shown in the dashboard" "${DEF_ORG:-My Organization}" v_nonempty \
  "Used as the tenant label in the UI."
ask CURRENCY "Display currency (ISO code, e.g. USD, CAD, EUR, GBP)" "USD" v_currency \
  "Only affects how costs are shown. Unit prices are estimates; see README, Pricing."
CURRENCY=${CURRENCY^^}
ask INACTIVITY_DAYS "Days without activity before a user counts as inactive" "90" v_days \
  "Exchange, OneDrive, SharePoint and Teams activity. 7 to 365."

[[ $ASSUME_YES == true ]] || { echo; bold "2. Where to deploy"; }
ask LOC "Azure region" "eastus" v_region \
  "Examples: eastus, westus2, canadacentral, westeurope, uksouth, australiaeast."
ask RG "Resource group name (created if missing)" "rg-license-optimizer" v_rg
ask SUFFIX "Short unique suffix for globally unique names (3-8 lowercase letters or digits)" \
  "$(printf '%05d' $((RANDOM % 100000)))" v_suffix \
  "Used in: acrlicopt<suffix>, app-licopt-<suffix> (the web address), kv-licopt-<suffix>, stlicopt<suffix>."
ask PLAN_SKU "App Service plan size" "B1" v_plan \
  "B1 is enough for most tenants. Basic or higher is required for Always On (daily reminders)."

[[ $ASSUME_YES == true ]] || { echo; bold "3. Access control"; }
ask GROUP_NAME "Entra group for read-only users" "SG-LicenseOptimizer-Users" v_group \
  "Only members of this group can open the dashboard. Created if missing; you are added."
ask ADMIN_GROUP_NAME "Entra group for admins (can run license and billing actions)" "SG-LicenseOptimizer-Admins" v_group

[[ $ASSUME_YES == true ]] || { echo; bold "4. Renewal reminder emails (optional)"; }
if [[ $ASSUME_YES == true ]]; then WANT_REMINDERS=$([[ -n ${REMINDER_SENDER:-} ]] && echo y || echo n)
elif ask_yn "Send renewal reminder emails?" "$([[ -n ${REMINDER_SENDER:-} ]] && echo y || echo n)"; then WANT_REMINDERS=y
else WANT_REMINDERS=n; fi
if [[ $WANT_REMINDERS == y ]]; then
  ask REMINDER_SENDER "Shared mailbox that sends the reminders" "${REMINDER_SENDER:-license-reminders@${DEF_DOMAIN:-example.com}}" v_email_opt \
    "A shared mailbox needs no license. You create it with deploy/Set-MailSendScope.ps1 (it can do that for you)."
  ask REMINDER_TIMEZONE "Time zone for the daily reminder run (IANA name, e.g. America/Toronto, Europe/London, UTC)" "UTC" v_tz
else
  REMINDER_SENDER=""; REMINDER_TIMEZONE=${REMINDER_TIMEZONE:-UTC}
fi

# ---------- derived names ----------
ACR=${ACR:-acrlicopt$SUFFIX}; PLAN=${PLAN:-asp-license-optimizer}
APP=${APP:-app-licopt-$SUFFIX}; KV=${KV:-kv-licopt-$SUFFIX}; ST=${ST:-stlicopt$SUFFIX}
# If the suffix changed since an earlier run, regenerate the derived names.
[[ $ACR == acrlicopt* && $ACR != "acrlicopt$SUFFIX" ]] && ACR=acrlicopt$SUFFIX
[[ $APP == app-licopt-* && $APP != "app-licopt-$SUFFIX" ]] && APP=app-licopt-$SUFFIX
[[ $KV == kv-licopt-* && $KV != "kv-licopt-$SUFFIX" ]] && KV=kv-licopt-$SUFFIX
[[ $ST == stlicopt* && $ST != "stlicopt$SUFFIX" ]] && ST=stlicopt$SUFFIX

# ---------- name availability (best effort) ----------
if [[ $HAVE_AZ == true ]]; then
  if az acr check-name -n "$ACR" --query nameAvailable -o tsv 2>/dev/null | grep -qi false; then
    warn "The container registry name $ACR is taken. Re-run with a different suffix."
  fi
  if az storage account check-name -n "$ST" --query nameAvailable -o tsv 2>/dev/null | grep -qi false; then
    warn "The storage account name $ST is taken. Re-run with a different suffix."
  fi
fi

# ---------- summary ----------
echo
bold "Summary"
cat <<EOF
  Organization       $ORG_NAME
  Currency           $CURRENCY        Inactivity window  $INACTIVITY_DAYS days
  Region             $LOC             Resource group     $RG
  Web app            https://$APP.azurewebsites.net
  Registry / vault   $ACR / $KV      Storage            $ST
  Plan size          $PLAN_SKU
  Access groups      $GROUP_NAME (read-only), $ADMIN_GROUP_NAME (admins)
  Reminder sender    ${REMINDER_SENDER:-(reminders off)}   Time zone  $REMINDER_TIMEZONE
EOF
echo
if [[ $ASSUME_YES != true ]] && ! ask_yn "Save these settings to $STATE?" y; then
  echo "Nothing saved. Run ./setup.sh again to start over."; exit 0
fi

umask 077
{
  for V in ORG_NAME CURRENCY INACTIVITY_DAYS REMINDER_SENDER REMINDER_TIMEZONE PLAN_SKU \
           RG LOC SUFFIX ACR PLAN APP KV TAG GROUP_NAME ADMIN_GROUP_NAME \
           GRAPH_APP_ID SIGNIN_APP_ID GROUP_ID ADMIN_GROUP_ID ST; do
    printf '%s=%q\n' "$V" "${!V:-}"
  done
} >"$STATE"
info "Saved $STATE (no secrets are stored there)."

[[ $CONFIGURE_ONLY == true ]] && exit 0

# ---------- deploy ----------
run_phases() {
  local p
  for p in "$@"; do
    info "Running phase: $p"
    ./deploy/deploy.sh "$p"
  done
}

if [[ -n $PHASES ]]; then
  # shellcheck disable=SC2086
  run_phases ${PHASES//,/ }
  exit 0
fi

[[ $HAVE_AZ == true ]] || { echo "Run ./deploy/deploy.sh all from Azure Cloud Shell to deploy."; exit 0; }

echo
bold "What next?"
cat <<'TXT'
  1) Deploy everything now (preflight, infra, auth, graph, upgrade)
  2) Demo only: deploy in mock mode (infra phase), no Entra changes
  3) Run the preflight checks only
  4) Exit (deploy later with ./deploy/deploy.sh all)
TXT
read -r -p "Choose 1-4 [3]: " CHOICE || CHOICE=3
case "${CHOICE:-3}" in
  1)
    echo
    warn "The auth and graph phases create app registrations and grant admin consent."
    echo "They need Global Administrator (or Privileged Role Administrator) to be ACTIVE (PIM)."
    ask_yn "Continue?" y || exit 0
    run_phases preflight infra auth graph upgrade ;;
  2) run_phases preflight infra ;;
  3) run_phases preflight ;;
  *) echo "Done. Deploy later with: ./deploy/deploy.sh all" ;;
esac

echo
bold "Finished. Next steps are in README.md (Reminder emails, first sign-in, rotating secrets)."
