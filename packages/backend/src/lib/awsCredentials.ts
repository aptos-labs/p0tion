/** A minimal secret reader, independent of Firebase and application initialization. */
export type SecretValueReader = { value(): string }

/**
 * Create a lazy getter. Do not resolve or cache credentials during module discovery.
 * The generic error deliberately excludes secret names, values, and reader errors.
 */
export const createAWSCredentialsGetter = (
    accessKey: SecretValueReader,
    secretKey: SecretValueReader
): (() => { accessKeyId: string; secretAccessKey: string }) => () => {
    let accessKeyId: string
    let secretAccessKey: string
    try {
        accessKeyId = accessKey.value()
        secretAccessKey = secretKey.value()
    } catch {
        throw new Error("AWS credentials are unavailable")
    }

    if (!accessKeyId || !secretAccessKey) throw new Error("AWS credentials are unavailable")

    return { accessKeyId, secretAccessKey }
}
