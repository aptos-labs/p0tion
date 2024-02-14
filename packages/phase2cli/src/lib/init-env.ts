import { readPackageUpSync } from "read-package-up"
import { config } from "dotenv"
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const { path: packageJsonPath } = readPackageUpSync({cwd: __dirname})

const dotEnvFilePath = path.dirname(packageJsonPath) + "/.env"

// load environment variables from .env
config({
    path: dotEnvFilePath
})
