// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  where,
  updateDoc,
  doc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAqNViWNYRTI2uQaMlj6QMg7TGiiUZZVZQ",
  authDomain: "taller-maquinas-herramientas.firebaseapp.com",
  projectId: "taller-maquinas-herramientas",
  storageBucket: "taller-maquinas-herramientas.firebasestorage.app",
  messagingSenderId: "79762926711",
  appId: "1:79762926711:web:83a33df56183f56d6a2a72",
  measurementId: "G-JJ7E3E2E79"
};

const app = initializeApp(firebaseConfig);

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6LfqPUgtAAAAAGotRzMTvetHw4a1pKbj-D5lftbZ"),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);

// true porque ya tenemos credenciales reales
const firebaseConfigurado = true;

export {
  db,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  where,
  updateDoc,
  doc,
  Timestamp,
  firebaseConfigurado
};
