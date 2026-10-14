/**
 * Jira MCP Server - Windows Credential Manager
 * 
 * Reads the Generic Credential stored under a target name (e.g. created with
 * `cmdkey /generic:JiraMCP`) via Win32 CredRead in PowerShell.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const readCredentialScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JiraCredentialReader {
  [StructLayout(LayoutKind.Sequential)]
  private struct Credential {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }

  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

  [DllImport("Advapi32.dll")]
  private static extern void CredFree(IntPtr credential);

  public static string[] Read(string target, uint type) {
    IntPtr pointer;
    if (!CredRead(target, type, 0, out pointer)) return null;

    try {
      Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      string username = Marshal.PtrToStringUni(credential.UserName) ?? "";
      int passwordLength = (int)(credential.CredentialBlobSize / 2);
      string password = credential.CredentialBlob == IntPtr.Zero || passwordLength == 0
        ? ""
        : Marshal.PtrToStringUni(credential.CredentialBlob, passwordLength) ?? "";
      return new string[] { username, password.TrimEnd('\0') };
    }
    finally {
      CredFree(pointer);
    }
  }
}
'@

$targetName = $env:JIRA_MCP_CREDENTIAL_TARGET
foreach ($credentialType in @(2, 1)) {
  $credential = [JiraCredentialReader]::Read($targetName, [uint32]$credentialType)
  if ($null -ne $credential -and -not [string]::IsNullOrEmpty($credential[1])) {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ account = $credential[0]; password = $credential[1] }))
    exit 0
  }
}
`;

export interface StoredCredential {
  account: string;
  password: string;
}

export const findWindowsCredential = async (
  target: string
): Promise<StoredCredential | null> => {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      readCredentialScript,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, JIRA_MCP_CREDENTIAL_TARGET: target },
    }
  );

  const output = stdout.trim();
  if (!output) {
    return null;
  }

  const credential = JSON.parse(output) as {
    account?: unknown;
    password?: unknown;
  };
  if (
    typeof credential.account !== 'string' ||
    typeof credential.password !== 'string'
  ) {
    throw new Error(
      'Windows Credential Manager returned an invalid credential'
    );
  }

  return { account: credential.account, password: credential.password };
};
