// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDQJeB1o4W6KnC_OlxGc1u1aPWsv40bICo",
    authDomain: "genesis-aec98.firebaseapp.com",
    projectId: "genesis-aec98",
    storageBucket: "genesis-aec98.firebasestorage.app",
    messagingSenderId: "1071823452533",
    appId: "1:1071823452533:web:ff7a7dd592249a6ea1fb3c"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
