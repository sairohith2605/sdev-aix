# Local Compose secrets

Compose reads the Fernet key from `credential_encryption_key` and mounts it only
into the backend container. Generate this file before starting the stack; the
file is ignored by Git. Back it up securely: losing the key makes saved Azure
DevOps credentials undecryptable.
