npx : Loaded Prisma config from prisma.config.ts.
At line:1 char:219
+ ... risma 2>&1; npx prisma migrate diff --from-url $env:DIRECT --to-schem ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Loaded Prisma c...isma.config.ts.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 

Error: 
`--from-url` was removed. Please use `--[from/to]-config-datasource` in combination with a Prisma config file that 
contains the appropriate datasource instead.

Usage

  $ prisma migrate diff [options]

Options

  -h, --help               Display this help message
  --config                 Custom path to your Prisma config file
  -o, --output             Writes to a file instead of stdout

From and To inputs (1 `--from-...` and 1 `--to-...` must be provided):
  --from-empty             Flag to assume from or to is an empty datamodel
  --to-empty

  --from-schema            Path to a Prisma schema file, uses the datamodel for the diff
  --to-schema

  --from-migrations        Path to the Prisma Migrate migrations directory
  --to-migrations

  --from-config-datasource Flag to use the datasource from the Prisma config file
  --to-config-datasource

Flags

  --script                 Render a SQL script to stdout instead of the default human readable summary (not supported 
on MongoDB)
  --exit-code              Change the exit code behavior to signal if the diff is empty or not (Empty: 0, Error: 1, 
Not empty: 2). Default behavior is Success: 0, Error: 1.

'sslmode' is not recognized as an internal or external command,
operable program or batch file.
'channel_binding' is not recognized as an internal or external command,
operable program or batch file.
