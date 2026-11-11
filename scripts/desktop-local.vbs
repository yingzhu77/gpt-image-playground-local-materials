Option Explicit
Dim shell, files, scriptPath, mode, nodePath, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 2 Then WScript.Quit 1
nodePath = WScript.Arguments(0)
mode = WScript.Arguments(1)
If mode <> "start" And mode <> "stop" Then WScript.Quit 1
scriptPath = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "start-local.mjs")
command = """" & nodePath & """ """ & scriptPath & """ "
If mode = "stop" Then
    command = command & "--stop"
Else
    command = command & "--background"
End If
shell.Run command, 0, False
