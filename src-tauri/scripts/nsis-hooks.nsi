; NSIS installer hooks for Archivist Desktop
; Configures Windows Firewall for P2P connectivity and HTTP servers

!macro CUSTOM_INSTALL
  ; Add Windows Firewall rules for P2P connectivity (port 8090)
  DetailPrint "Configuring Windows Firewall for P2P connectivity..."

  ; Add TCP rule for P2P
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Archivist P2P TCP" dir=in action=allow protocol=tcp localport=8090'

  ; Add UDP rule for P2P
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Archivist P2P UDP" dir=in action=allow protocol=udp localport=8090'

  DetailPrint "Firewall rules configured for Archivist P2P"

  ; Add Windows Firewall rules for ManifestServer (port 8085)
  ; This allows backup peers to discover manifest CIDs
  DetailPrint "Configuring Windows Firewall for Manifest Discovery Server..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Archivist ManifestServer" dir=in action=allow protocol=tcp localport=8085'

  ; Add Windows Firewall rules for Backup Trigger Server (port 8086)
  ; This allows source machines to notify this machine of new manifests
  DetailPrint "Configuring Windows Firewall for Backup Trigger Server..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Archivist Backup Trigger" dir=in action=allow protocol=tcp localport=8086'

  DetailPrint "All firewall rules configured for Archivist"

  ; Clear corrupted block store from previous versions to avoid
  ; "Cid doesn't match the data" manifest errors after sidecar upgrades
  DetailPrint "Clearing legacy block store for compatibility..."
  RMDir /r "$APPDATA\archivist\repo"
!macroend

!macro CUSTOM_UNINSTALL
  ; Remove Windows Firewall rules on uninstall
  DetailPrint "Removing Archivist firewall rules..."

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Archivist P2P TCP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Archivist P2P UDP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Archivist ManifestServer"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Archivist Backup Trigger"'

  DetailPrint "All firewall rules removed"
!macroend
