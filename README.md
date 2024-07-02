# nuveplatform-start-backup

Start a new instance of a [Nuve Platform](https://nuveplatform.com) backup.

# Usage
```
- uses: simonegaffurini/nuveplatform-start-backup@main
  with:
    # Nuve Platform login email
    email: ''

    # Nuve Platform login password
    password: ''

    # Name of the backup
    backup: ''

    # Name of the instance that will be created
    instanceName: ''

    # Name of the project of the instance that will be created
    instanceProject: ''

    # Timeout (in seconds) after which the action won't check of SAP running
    # Default: 600 (10 minutes)
    timeout: 600

```