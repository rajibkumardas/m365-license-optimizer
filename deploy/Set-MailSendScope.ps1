<#
.SYNOPSIS
  Lets the M365 License Optimizer send reminder emails from ONE shared mailbox only.

.DESCRIPTION
  Uses Exchange Online "RBAC for Applications" instead of granting Microsoft Graph Mail.Send
  in Entra ID (which would allow sending as ANY mailbox in the tenant).
    1. Creates the shared mailbox if it does not exist (shared mailboxes need no license).
    2. Registers the app's service principal in Exchange Online.
    3. Creates a management scope that matches only that mailbox.
    4. Assigns the "Application Mail.Send" role to the app, limited to that scope.
    5. Verifies with Test-ServicePrincipalAuthorization.

  IMPORTANT: do NOT also grant Mail.Send to the app in Entra ID. Entra and Exchange RBAC
  permissions are combined, so an Entra grant would undo the restriction.

  Requires: ExchangeOnlineManagement module (preinstalled in Azure Cloud Shell PowerShell),
  Exchange Administrator (or Global Administrator) role.

.EXAMPLE
  ./Set-MailSendScope.ps1 -AppId <graph-reader-appId> -ServicePrincipalObjectId <its-SP-objectId> -Mailbox license-reminders@contoso.com

.NOTES
  Rollback:
    Get-ManagementRoleAssignment -RoleAssignee <AppId> | Where-Object Role -eq 'Application Mail.Send' | Remove-ManagementRoleAssignment -Confirm:$false
    Remove-ManagementScope -Identity 'LicenseOptimizer-Sender' -Confirm:$false
    Remove-ServicePrincipal -Identity <AppId> -Confirm:$false
    (optional) Remove-Mailbox -Identity <the sender mailbox>
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string] $AppId,
    [Parameter(Mandatory)] [string] $ServicePrincipalObjectId,
    [Parameter(Mandatory)] [string] $Mailbox,
    [string] $MailboxDisplayName = 'IT Licensing',
    [string] $ScopeName = 'LicenseOptimizer-Sender'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command Connect-ExchangeOnline -ErrorAction SilentlyContinue)) {
    throw 'ExchangeOnlineManagement module not found. Install-Module ExchangeOnlineManagement -Scope CurrentUser'
}
if (-not (Get-ConnectionInformation -ErrorAction SilentlyContinue)) {
    Connect-ExchangeOnline -ShowBanner:$false
}

try {
    # 1. Shared mailbox
    $mbx = Get-EXOMailbox -Identity $Mailbox -ErrorAction SilentlyContinue
    if (-not $mbx) {
        if ($PSCmdlet.ShouldProcess($Mailbox, 'Create shared mailbox')) {
            $alias = ($Mailbox.Split('@')[0]) -replace '[^a-zA-Z0-9]', ''
            New-Mailbox -Shared -Name $MailboxDisplayName -DisplayName $MailboxDisplayName -Alias $alias -PrimarySmtpAddress $Mailbox -ErrorAction Stop | Out-Null
            Write-Host "Created shared mailbox $Mailbox"
        }
    } else {
        Write-Host "Mailbox $Mailbox exists ($($mbx.RecipientTypeDetails))"
    }

    # 2. Service principal pointer in Exchange Online
    if (-not (Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue)) {
        if ($PSCmdlet.ShouldProcess($AppId, 'Register service principal in Exchange Online')) {
            New-ServicePrincipal -AppId $AppId -ObjectId $ServicePrincipalObjectId -DisplayName 'M365 License Optimizer' -ErrorAction Stop | Out-Null
            Write-Host 'Registered service principal in Exchange Online'
        }
    }

    # 3. Management scope matching only the sender mailbox
    if (-not (Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue)) {
        if ($PSCmdlet.ShouldProcess($ScopeName, "Create management scope for $Mailbox")) {
            New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'" -ErrorAction Stop | Out-Null
            Write-Host "Created management scope $ScopeName"
        }
    }

    # 4. Application Mail.Send, limited to that scope
    $existing = Get-ManagementRoleAssignment -RoleAssignee $AppId -ErrorAction SilentlyContinue | Where-Object { $_.Role -eq 'Application Mail.Send' }
    if (-not $existing) {
        if ($PSCmdlet.ShouldProcess($AppId, "Assign Application Mail.Send scoped to $ScopeName")) {
            New-ManagementRoleAssignment -App $AppId -Role 'Application Mail.Send' -CustomResourceScope $ScopeName -ErrorAction Stop | Out-Null
            Write-Host 'Assigned Application Mail.Send (scoped)'
        }
    } else {
        Write-Host 'Application Mail.Send already assigned'
    }

    # 5. Verify: should be InScope = True for the sender, False for anyone else
    Write-Host "`nVerification (permission changes can take up to 30 minutes to apply):"
    Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox | Format-List
}
catch {
    Write-Error "Failed: $($_.Exception.Message)"
    throw
}
