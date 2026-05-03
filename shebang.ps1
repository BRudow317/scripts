function shebang {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$Path,

        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ScriptArgs
    )

    # 1. Ensure the file actually exists
    if (-not (Test-Path $Path)) {
        Write-Error "File not found: $Path"
        return
    }

    # 2. Read only the very first line of the file for performance
    $firstLine = Get-Content -Path $Path -TotalCount 1 -ErrorAction Stop

    # 3. Check if it starts with the magic bytes #!
    if ($firstLine -match '^#!\s*(.+)') {
        $shebang = $matches[1].Trim()
        
        # Split by whitespace to separate the binary from potential flags
        $parts = -split $shebang 
        $interpreter = $parts[0]
        $interpreterArgs = @()

        # 4. Handle the dynamic "/usr/bin/env <binary>" paradigm
        if ($interpreter -match 'env$') {
            if ($parts.Count -gt 1) {
                $interpreter = $parts[1] # e.g., 'python3' or 'bash'
                if ($parts.Count -gt 2) {
                    $interpreterArgs = $parts[2..($parts.Count-1)]
                }
            } else {
                Write-Error "Shebang uses 'env' but specifies no interpreter: $firstLine"
                return
            }
        } 
        # 5. Handle direct paths like "/bin/bash" or "/usr/bin/python"
        else {
            # This rips the 'bash' out of '/bin/bash' so Windows can find it in PATH
            $interpreter = [System.IO.Path]::GetFileName($interpreter)
            if ($parts.Count -gt 1) {
                $interpreterArgs = $parts[1..($parts.Count-1)]
            }
        }

        # 6. Verify the interpreter actually exists on this Windows machine
        if (-not (Get-Command $interpreter -ErrorAction SilentlyContinue)) {
            Write-Error "Interpreter '$interpreter' not found in system PATH."
            return
        }

        # 7. Execute the script natively in the current shell
        # Using the call operator (&) binds the streams to the current console
        & $interpreter $interpreterArgs $Path $ScriptArgs

    } 
    else {
        # Fallback: If no shebang exists, treat it like a standard bash script 
        # (This matches Linux's standard fallback behavior)
        Write-Warning "No shebang found in $Path. Falling back to Bash execution."
        & bash $Path $ScriptArgs
    }
}

# Create a fast alias so you don't have to type Invoke-Shebang every time
Set-Alias bang Invoke-Shebang
Set-Alias dot Invoke-Shebang