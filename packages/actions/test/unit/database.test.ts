import chai, { expect, assert } from "chai"
import chaiAsPromised from "chai-as-promised"
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth"
import { where } from "firebase/firestore"
import { CeremonyState } from "@zkmpc/actions/src/types/enums"
import { fakeCeremoniesData, fakeCircuitsData, fakeUsersData } from "../data/samples"
import {
    getCurrentFirebaseAuthUser,
    queryCollection,
    fromQueryToFirebaseDocumentInfo,
    getAllCollectionDocs,
    getCurrentContributorContribution,
    getDocumentById,
    getCurrentActiveParticipantTimeout,
    getClosedCeremonies
} from "../../src"
import {
    setCustomClaims,
    createNewFirebaseUserWithEmailAndPw,
    deleteAdminApp,
    generatePseudoRandomStringOfNumbers,
    initializeAdminServices,
    initializeUserServices,
    sleep
} from "../utils"

chai.use(chaiAsPromised)

/**
 * Unit test for Firebase helpers.
 * @notice some of these methods are used as a core component for authentication.
 */
describe("Database", () => {
    // Init firebase services.
    const { adminFirestore, adminAuth } = initializeAdminServices()
    const { userApp, userFirestore } = initializeUserServices()
    const userAuth = getAuth(userApp)

    // Sample data for running the test.
    const user = fakeUsersData.fakeUser2
    const coordinatorEmail = "coordinator@coordinator.com"
    // storing the uid so we can delete the user after the test
    let coordinatorUid: string

    // generate passwords for user and coordinator
    const userPwd = generatePseudoRandomStringOfNumbers(24)
    const coordinatorPwd = generatePseudoRandomStringOfNumbers(24)

    beforeAll(async () => {
        // create a new user without contributor privileges
        await createNewFirebaseUserWithEmailAndPw(userApp, user.data.email, userPwd)
        await sleep(5000)

        // Retrieve the current auth user in Firebase.
        const currentAuthenticatedUser = getCurrentFirebaseAuthUser(userApp)
        user.uid = currentAuthenticatedUser.uid

        // create account for coordinator
        await createNewFirebaseUserWithEmailAndPw(userApp, coordinatorEmail, coordinatorPwd)
        await sleep(5000)

        const currentAuthenticatedCoordinator = getCurrentFirebaseAuthUser(userApp)
        coordinatorUid = currentAuthenticatedCoordinator.uid

        // add custom claims for coordinator privileges
        await setCustomClaims(adminAuth, coordinatorUid, { coordinator: true })

        // Create the mock data on Firestore.
        await adminFirestore
            .collection(`ceremonies`)
            .doc(fakeCeremoniesData.fakeCeremonyOpenedFixed.uid)
            .set({
                ...fakeCeremoniesData.fakeCeremonyOpenedFixed.data
            })

        await adminFirestore
            .collection(`ceremonies/${fakeCeremoniesData.fakeCeremonyOpenedFixed.uid}/circuits`)
            .doc(fakeCircuitsData.fakeCircuitSmallNoContributors.uid)
            .set({
                ...fakeCircuitsData.fakeCircuitSmallNoContributors.data
            })

        await adminFirestore
            .collection(`ceremonies`)
            .doc(fakeCeremoniesData.fakeCeremonyClosedDynamic.uid)
            .set({
                ...fakeCeremoniesData.fakeCeremonyClosedDynamic.data
            })

        await adminFirestore
            .collection(`ceremonies/${fakeCeremoniesData.fakeCeremonyClosedDynamic.uid}/circuits`)
            .doc(fakeCircuitsData.fakeCircuitSmallContributors.uid)
            .set({
                ...fakeCircuitsData.fakeCircuitSmallContributors.data
            })
    })

    describe("queryCollection", () => {
        it("should not allow the coordinator to query the users collection", async () => {
            // sign in as a coordinator
            await signInWithEmailAndPassword(userAuth, coordinatorEmail, coordinatorPwd)
            await setCustomClaims(adminAuth, coordinatorUid, { coordinator: true })
            const currentAuthenticatedCoordinator = getCurrentFirebaseAuthUser(userApp)
            // refresh target
            await currentAuthenticatedCoordinator.getIdToken(true)
            assert.isRejected(queryCollection(userFirestore, "users", [where("email", "==", user.data.email)]))
        })
        it("should allow any authenticated user to query the ceremonies collection", async () => {
            // Sign in as coordinator.
            await signInWithEmailAndPassword(userAuth, user.data.email, userPwd)
            const query = await queryCollection(userFirestore, "ceremonies", [
                where("state", "==", CeremonyState.OPENED)
            ])
            expect(query.docs.length).to.be.gt(0)
        })
        it("should revert when not logged in", async () => {
            await signOut(userAuth)
            assert.isRejected(
                queryCollection(userFirestore, "ceremonies", [where("state", "==", CeremonyState.OPENED)])
            )
        })
    })

    describe("getAllCollectionDocs", () => {
        it("should not allow the coordinator to query all the users collection", async () => {
            // sign in as a coordinator
            await signInWithEmailAndPassword(userAuth, coordinatorEmail, coordinatorPwd)
            assert.isRejected(getAllCollectionDocs(userFirestore, "users"))
        })
        it("should revert when a non coordinator tries to query the users collection", async () => {
            // sign in as a participant
            await signInWithEmailAndPassword(userAuth, user.data.email, userPwd)
            assert.isRejected(getAllCollectionDocs(userFirestore, "users"))
        })
        it("should allow any authenticated user to query the ceremonies collection", async () => {
            // Sign in as coordinator.
            await signInWithEmailAndPassword(userAuth, user.data.email, userPwd)
            const collection = await getAllCollectionDocs(userFirestore, "ceremonies")
            expect(collection.length).to.be.gt(0)
        })
        it("should revert when not logged in", async () => {
            await signOut(userAuth)
            assert.isRejected(getAllCollectionDocs(userFirestore, "ceremonies"))
        })
    })

    describe("fromQueryToFirebaseDocumentInfo", () => {
        it("should return data for a valid collection", async () => {
            // sign in as a coordinator
            await signInWithEmailAndPassword(userAuth, coordinatorEmail, coordinatorPwd)
            const collection = await getAllCollectionDocs(userFirestore, "ceremonies")
            expect(collection.length).to.be.gt(0)
            const collectionInfo = fromQueryToFirebaseDocumentInfo(collection)
            expect(collectionInfo).to.not.be.null
        })
        it("should not return any data when given an empty collection", async () => {
            // Sign in as coordinator.
            const collectionInfo = fromQueryToFirebaseDocumentInfo([] as any)
            expect(collectionInfo.length).to.be.eq(0)
        })
    })

    describe("getDocumentById", () => {
        it("should allow an authenticated user to get a document with their own data", async () => {
            await signInWithEmailAndPassword(userAuth, user.data.email, userPwd)
            const userDoc = await getDocumentById(userFirestore, "users", user.uid)
            expect(userDoc).to.not.be.null
        })
        it("should revert when not logged in", async () => {
            await signOut(userAuth)
            assert.isRejected(getDocumentById(userFirestore, "users", user.uid))
        })
        it("should an authenticated user to get a ceremonies document", async () => {
            await signInWithEmailAndPassword(userAuth, user.data.email, userPwd)
            const userDoc = await getDocumentById(
                userFirestore,
                "ceremonies",
                fakeCeremoniesData.fakeCeremonyOpenedFixed.uid
            )
            expect(userDoc).to.not.be.null
        })
    })

    describe("getCurrentContributorContribution", () => {
        it("should return an empty array when a ceremony has not participants", async () => {
            const contributions = await getCurrentContributorContribution(
                userFirestore,
                fakeCircuitsData.fakeCircuitSmallNoContributors.uid,
                fakeCeremoniesData.fakeCeremonyOpenedFixed.uid,
                user.uid
            )
            expect(contributions.length).to.be.eq(0)
        })
        // @todo add more tests when testing contributions
    })

    describe("getClosedCeremonies", () => {
        it("should return all closed ceremonies", async () => {
            const closedCeremonies = await getClosedCeremonies(userFirestore)
            expect(closedCeremonies.length).to.be.gt(0)
        })
        it("should not return any closed ceremonies after removing the data from the db", async () => {
            // here we delete the circuit and the ceremony so we run this test last
            await adminFirestore
                .collection(`ceremonies/${fakeCeremoniesData.fakeCeremonyClosedDynamic.uid}/circuits`)
                .doc(fakeCircuitsData.fakeCircuitSmallNoContributors.uid)
                .delete()

            await adminFirestore.collection(`ceremonies`).doc(fakeCeremoniesData.fakeCeremonyClosedDynamic.uid).delete()

            expect(getClosedCeremonies(userFirestore)).to.be.rejectedWith(
                "Queries-0001: There are no ceremonies ready to finalization"
            )
        })
    })

    describe("getCurrentActiveParticipantTimeout", () => {
        // @todo add more tests when testing contibution
        it("should return an empty array when querying a ceremony's circuits without contributors", async () => {
            const timeout = await getCurrentActiveParticipantTimeout(
                userFirestore,
                fakeCeremoniesData.fakeCeremonyOpenedFixed.uid,
                user.uid
            )
            expect(timeout.length).to.be.eq(0)
        })
    })

    afterAll(async () => {
        await adminFirestore.collection("users").doc(user.uid).delete()
        await adminFirestore.collection("users").doc(coordinatorUid).delete()
        // Remove Auth user.
        await adminAuth.deleteUser(user.uid)
        await adminAuth.deleteUser(coordinatorUid)
        // Delete mock ceremony data.
        await adminFirestore
            .collection(`ceremonies/${fakeCeremoniesData.fakeCeremonyOpenedFixed.uid}/circuits`)
            .doc(fakeCircuitsData.fakeCircuitSmallNoContributors.uid)
            .delete()

        await adminFirestore.collection(`ceremonies`).doc(fakeCeremoniesData.fakeCeremonyOpenedFixed.uid).delete()

        // Delete admin app.
        await deleteAdminApp()
    })
})
