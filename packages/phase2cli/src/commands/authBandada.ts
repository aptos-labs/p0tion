import { Identity } from "@semaphore-protocol/identity"
import { generateProof } from "@semaphore-protocol/proof"
import { Group } from "@semaphore-protocol/group"

// import { terminate } from "../lib/utils.js"
import { encodeBytes32String, toBigInt } from "ethers"
import { addMemberToGroup, getGroup, isGroupMember } from "../lib/bandada.js"
import { checkLocalBandadaIdentity, getLocalBandadaIdentity, setLocalBandadaIdentity } from "../lib/localConfigs.js"
import { showError } from "../lib/errors.js"

const { BANDADA_DASHBOARD_URL, BANDADA_GROUP_ID } = process.env

const authBandada = async () => {
    // 1. check if _identity string exists in local storage
    let identityString: string | unknown
    const isIdentityStringStored = checkLocalBandadaIdentity()
    if (isIdentityStringStored) {
        identityString = getLocalBandadaIdentity()
    } else {
        // 2. generate a random _identity string and save it in local storage
        identityString = "random string"
        setLocalBandadaIdentity(identityString as string)
    }

    // 3. create a semaphore identity with _identity string as a seed
    const identity = new Identity(identityString as string)
    const commitment = identity.commitment.toString()
    const isMember = await isGroupMember(BANDADA_GROUP_ID, identity)
    if (!isMember) {
        await addMemberToGroup(BANDADA_GROUP_ID, BANDADA_DASHBOARD_URL, identity)
    }

    // 8. generate a proof with signal = `I am ${ commitment } for the X ceremony`
    const group = await getGroup(BANDADA_GROUP_ID)
    if (!group) showError("Bandada group not found", true)
    const tempGroup = new Group(BANDADA_GROUP_ID, group.treeDepth, group.members)

    const signal = toBigInt(encodeBytes32String(`I am ${commitment} for the X ceremony`)).toString()
    console.log("before generate proof")
    const { proof, merkleTreeRoot, nullifierHash } = await generateProof(identity, tempGroup, BANDADA_GROUP_ID, signal)
    console.log(proof)
    console.log(nullifierHash)
    console.log(merkleTreeRoot)

    // 9. send proof to a custom server that verifies it (server build by Nico. In the future Bandada should have an endpoint for this)
    console.log("after everything")
    // terminate(commitment)
}

export default authBandada
