import { readPackageUpSync } from "read-package-up"
import { config } from "dotenv"
import path from "node:path"

export const { path: packageJsonPath } = readPackageUpSync()

// load environment variables from .env
config({
    path: path.dirname(packageJsonPath)
})
