import assert from 'node:assert/strict';

// This is a NONSECRET deployment allowlist, not a general dotenv converter.
export const CONFIG_KEYS = Object.freeze([
    'AWS_REGION',
    'AWS_PRESIGNED_URL_EXPIRATION',
    'AWS_CEREMONY_BUCKET_POSTFIX',
    'AWS_INSTANCE_PROFILE_ARN',
    'AWS_AMI_ID',
    'AWS_SNS_TOPIC_ARN',
    'CUSTOM_CLAIMS_COORDINATOR_EMAIL_ADDRESS_OR_DOMAIN',
    'CUSTOM_CONTRIBUTION_VERIFICATION_SOFTWARE_NAME',
    'CUSTOM_CONTRIBUTION_VERIFICATION_SOFTWARE_VERSION',
    'CUSTOM_CONTRIBUTION_VERIFICATION_SOFTWARE_COMMIT_HASH',
].sort());
export const configRelative = 'packages/backend/deployment.config.json';
const safeValue = /^[A-Za-z0-9_.:@/\-]+$/;

export function validateConfig(config) {
    assert(
        config !== null && typeof config === 'object' && !Array.isArray(config),
        'Deployment config must be a JSON object',
    );
    assert.deepEqual(
        Object.keys(config).sort(),
        CONFIG_KEYS,
        'Deployment config requires exactly the ten approved nonsecret keys',
    );
    const validated = {};
    for (const key of CONFIG_KEYS) {
        const value = config[key];
        assert(
            typeof value === 'string' && safeValue.test(value) && !/[\r\n]/.test(value),
            `Invalid nonsecret config value: ${key} (nonempty safe single-line string required)`,
        );
        if (key === 'AWS_PRESIGNED_URL_EXPIRATION') {
            assert(/^[1-9][0-9]*$/.test(value), 'Expiration must be a positive integer string');
        }
        validated[key] = value;
    }
    return validated;
}

export function serializeConfig(config) {
    const validated = validateConfig(config);
    return CONFIG_KEYS.map((key) => `${key}=${validated[key]}\n`).join('');
}
