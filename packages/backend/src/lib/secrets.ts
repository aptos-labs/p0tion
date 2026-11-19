import { defineSecret } from "firebase-functions/params"
import { createAWSCredentialsGetter } from "./awsCredentials"
import { getAWSRuntimeServiceAccount } from "./awsRuntimeIdentity"

export const AWS_RUNTIME_SERVICE_ACCOUNT = getAWSRuntimeServiceAccount(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
)

// Keep these names unchanged: indirect zk-actions helpers read the injected environment.
export const AWS_ACCESS_KEY_ID = defineSecret("AWS_ACCESS_KEY_ID")
export const AWS_SECRET_ACCESS_KEY = defineSecret("AWS_SECRET_ACCESS_KEY")

export const AWS_SECRETS = [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY]

// Creating the getter does not call .value(); only runtime helper invocation does.
export const getAWSCredentials = createAWSCredentialsGetter(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
