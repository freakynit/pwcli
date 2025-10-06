# pwcli - Secure CLI Password Manager

A simple, secure Node.js CLI password manager with an interactive TUI, fully encrypted vault storage, and AES-256-GCM encryption.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

## Features

- 🔐 **Secure Encryption**: AES-256-GCM with scrypt key derivation
- 🎨 **Fancy Interactive TUI**: Beautiful terminal interface with fuzzy search
- 🔍 **Live Fuzzy Search**: Quickly find entries as you type
- 📋 **Clipboard Integration**: Auto-copy passwords with automatic clearing after 20s
- 🔒 **File Locking**: Prevents concurrent vault corruption
- 💣 **Secure Deletion**: Best-effort secure wipe when nuking vault
- 🚀 **Zero Config**: Works out of the box with sensible defaults

## Security

### Encryption Details

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: scrypt with N=32768, r=8, p=1
- **Salt**: 16 random bytes per vault
- **IV**: 12 random bytes per encryption operation
- **Authentication**: GCM authentication tag ensures integrity

### Security Features

- Master password never stored on disk
- All vault data encrypted at rest
- No plaintext secrets ever written to disk
- Fail-closed: operations fail without correct master password
- Clipboard auto-clear after 20 seconds
- File locking prevents concurrent write corruption
- Rate limiting on password attempts (1 per second)
- Secure wipe on vault deletion (best-effort)

### Vault File Structure

The vault file (`~/.pw-vault.json` by default) contains:

```json
{
  "kdf": "scrypt",
  "salt": "<base64>",
  "iv": "<base64>",
  "authTag": "<base64>",
  "data": "<base64 encrypted payload>"
}
```

The encrypted payload contains:

```json
{
  "entries": {
    "entry-key": {
      "username": "optional-username",
      "password": "the-password"
    }
  },
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

## Installation

### Prerequisites

- Node.js 18 or higher

### Install from npm

```bash
npm install -g @freakynit/pwcli
```

### Install from GitHub

```bash
npm install -g freakynit/pwcli
```

### Install from Source

Clone and install:

```bash
git clone https://github.com/freakynit/pwcli.git
cd pwcli
npm install
npm link
```

Or install directly from the project directory:

```bash
npm install -g .
```

## Usage

### First Run

On first run, pwcli will guide you through setup:

```bash
pwcli
```

You'll be asked to:

1. Choose vault file location (default: `~/.pw-vault.json`)
2. Create a master password
3. Confirm the master password

### Interactive Mode (Default)

Simply run `pwcli` to enter interactive menu mode:

```bash
pwcli
```

#### Menu Options

- **🔍 Search / Get password**: Fuzzy search for an entry and copy password to clipboard
- **➕ Add entry**: Create a new password entry
- **✏️ Update entry**: Modify an existing entry
- **🗑️ Delete entry**: Remove an entry from vault
- **📋 List all keys**: Display all entry names (no passwords)
- **🔐 Change master password**: Update your master password
- **📁 Change vault location**: Move vault to a new location
- **💣 Nuke all (DANGER)**: Securely delete entire vault
- **👋 Quit**: Exit pwcli

### Direct Commands

You can also run commands directly:

```bash
# Search/get password
pwcli search

# Add new entry
pwcli add

# Update entry
pwcli update

# Delete entry
pwcli delete

# List all keys
pwcli list

# Change master password
pwcli change-master

# Change vault location
pwcli change-file

# Nuke vault (dangerous!)
pwcli nuke
```

### Typical Workflow

#### Adding a Password

1. Run `pwcli` or `pwcli add`
2. Enter master password
3. Enter entry name (e.g., "github", "email", "work-vpn")
4. Enter username (optional)
5. Enter password

#### Getting a Password

1. Run `pwcli` or `pwcli search`
2. Enter master password
3. Start typing to fuzzy search
4. Press Enter on the desired entry
5. Password is copied to clipboard
6. Clipboard auto-clears after 20 seconds

#### Updating a Password

1. Run `pwcli` or `pwcli update`
2. Enter master password
3. Search for entry to update
4. Enter new username/password
5. Changes saved and re-encrypted

## Configuration

pwcli stores minimal configuration in `~/.pwcli.json`:

```json
{
  "vaultPath": "/absolute/path/to/vault.json"
}
```

**No secrets are stored in this file.** Only the path to your encrypted vault.

## Troubleshooting

### Invalid Password Error

If you see "Decryption failed - invalid password or corrupted vault":

- Double-check you're entering the correct master password
- Ensure vault file hasn't been corrupted
- If you've forgotten your password, there's no recovery (encryption is secure!)

### Lock Errors

If you get lock-related errors:

- Another pwcli process may be writing to the vault
- Wait a moment and retry
- If persistent, check for stale `.lock` files next to your vault

### Corrupted Vault

If your vault file is corrupted:

- Restore from backup if available
- No way to recover without valid encrypted data
- This is why secure backups are important!

### Permission Errors

If you can't read/write vault:

- Check file permissions: `ls -la ~/.pw-vault.json`
- Ensure you own the file: `chown $USER ~/.pw-vault.json`

### Clipboard Not Working

- Ensure your system supports clipboard operations
- On Linux, you may need `xclip` or `xsel` installed
- On WSL, clipboard support may be limited

## Nuke (Secure Deletion)

The "Nuke" operation permanently destroys your vault:

1. Requires master password verification
2. Must type "NUKE" to confirm
3. Requires additional confirmation prompt
4. Overwrites vault file with random data
5. Overwrites with zeros
6. Deletes vault file and configuration

**This is irreversible!** All passwords will be permanently lost. After nuking, you can run `pwcli` again to set up a fresh vault.

## Best Practices

### Password Security

- Use a strong, unique master password
- Never share your master password
- Store master password in a secure location (not in the vault!)
- Consider using a passphrase (e.g., "correct-horse-battery-staple")

### Vault Backup

- Regularly backup your vault file
- Store backups securely (they're encrypted!)
- Test backup restoration periodically

### General Usage

- Don't leave terminal open with vault decrypted
- Clear terminal scrollback after viewing sensitive data
- Be aware of screen sharing when using pwcli
- Use list/search instead of displaying all passwords

## Technical Details

### Dependencies

- **enquirer**: Interactive prompts and autocomplete
- **fuse.js**: Fuzzy search algorithm
- **clipboardy**: Cross-platform clipboard access
- **chalk**: Terminal colors
- **ora**: Loading spinners
- **proper-lockfile**: File locking

### File Structure

```
pwcli/
├── bin/
│   └── pw.js           # Executable entry point
├── src/
│   ├── index.js        # Main application logic
│   ├── crypto.js       # Encryption/decryption
│   ├── vault.js        # Vault operations
│   ├── config.js       # Configuration management
│   ├── clipboard.js    # Clipboard operations
│   ├── ui.js           # User interface
│   ├── validation.js   # Input validation
│   └── ratelimit.js    # Rate limiting for password attempts
├── package.json
└── README.md
```

## License

MIT

## Contributing

Contributions welcome! Please ensure:

- Code follows existing style
- Security considerations are maintained
- No plaintext secrets in logs or errors
- Tests added for new features (if applicable)

## Disclaimer

- This is a personal password manager tool. While it uses industry-standard encryption, use at your own risk. Always maintain backups of your vault file. The authors are not responsible for lost passwords or data.
- Also, this is 100% vibe-coded. But, reviewed multiple times thereafter.

## Support

For issues, questions, or contributions, please open an issue on the [GitHub repository](https://github.com/freakynit/pwcli).

## Author

Created by [@freakynit](https://github.com/freakynit)

---

**Remember**: Your master password is the only key to your vault. If you lose it, your data cannot be recovered. Choose wisely and store it securely!
