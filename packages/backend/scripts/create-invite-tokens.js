const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');

function generateSecureRandomString() {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let result = '';
  
  for (let i = 0; i < 16; i++) {
    const randomByte = crypto.randomBytes(1)[0];
    const index = randomByte % charactersLength; // Ensuring uniform distribution
    result += characters.charAt(index);
  }
  
  return result;
}

console.log(generateSecureRandomString());


// Replace the path with your actual path to the Firebase admin SDK JSON file
// var serviceAccount = require('./path/to/your-firebase-adminsdk.json');

admin.initializeApp({
  projectId: "aptos-p0tion-dev"
  // credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const codes = []

async function createEmptyDocuments() {
  const collectionName = 'inviteCodes'; // Change this to your collection name

  for (let i = 0; i < 500; i++) {
    const inviteCode = generateSecureRandomString();
    codes.push(inviteCode);
    await db.collection(collectionName).doc(inviteCode).set({})
      .then(() => console.log(`Document ${i+1} created successfully`))
      .catch((error) => console.error(`Error creating document ${i+1}: `, error));
  }

  fs.writeFileSync('inviteCodes.csv', codes.join('\n'));

  console.log('All documents created');
}

createEmptyDocuments();