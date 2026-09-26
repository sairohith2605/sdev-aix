# Local Compose data

The `init-key` Compose service creates the Fernet key automatically in the
persistent `backend-data` volume before starting the backend. The key is stored
alongside the SQLite database at `/data/credential_encryption_key`; the init
service only creates a missing key and refuses to replace an invalid one. Back
up the whole volume: a database backup without its key cannot decrypt saved
Azure DevOps credentials. Manual backend runs outside Compose still need
`CREDENTIAL_ENCRYPTION_KEY` configured separately.
