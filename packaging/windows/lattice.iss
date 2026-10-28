; Lattice for Windows: installs for the current user (no administrator needed), with a Start menu entry and,
; if asked, one on the desktop. Built by the Windows workflow: iscc /DVersion=x.y.z packaging\windows\lattice.iss
#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
AppId={{6F1C2B7E-3A54-4F0B-9E1D-2C7A5B8D4E61}
AppName=Lattice
AppVersion={#Version}
AppPublisher=Vimalinx
AppPublisherURL=https://github.com/vimalinx/lattice
DefaultDirName={localappdata}\Programs\Lattice
DefaultGroupName=Lattice
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=Lattice-{#Version}-setup
SetupIconFile=..\build\lattice.ico
UninstallDisplayIcon={app}\Lattice.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
; Simplified Chinese where the workflow found its translation (it ships with newer Inno Setup releases).
#ifexist "ChineseSimplified.isl"
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
#endif
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\dist\Lattice\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Lattice"; Filename: "{app}\Lattice.exe"
Name: "{group}\{cm:UninstallProgram,Lattice}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Lattice"; Filename: "{app}\Lattice.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Lattice.exe"; Description: "{cm:LaunchProgram,Lattice}"; Flags: nowait postinstall skipifsilent
