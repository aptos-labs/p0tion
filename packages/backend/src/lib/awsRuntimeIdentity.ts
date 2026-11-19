// Resolve from the deployment project, never from a credential or a default identity.
export const getAWSRuntimeServiceAccount = (projectId: string | undefined): string => {
    if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
        throw new Error("A valid GCP project ID is required for the AWS function runtime identity")
    }
    return `p0tion-aws-functions@${projectId}.iam.gserviceaccount.com`
}
