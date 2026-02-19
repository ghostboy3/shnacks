// Firebase initialization for client-side auth and Firestore
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAo6ikKR1J1yDQKujxkvUnVGp8OyYdRK1M",
    authDomain: "shnackathon.firebaseapp.com",
    projectId: "shnackathon",
    storageBucket: "shnackathon.firebasestorage.app",
    messagingSenderId: "923233326006",
    appId: "1:923233326006:web:52b1d454d16361f7c0a717",
    measurementId: "G-5NSBP2V26M"
  };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

export { auth, provider, db };

