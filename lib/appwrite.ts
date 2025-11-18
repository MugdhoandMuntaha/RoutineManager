import { Client, Databases } from "appwrite";

export const appwrite = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT!);

export const db = new Databases(appwrite);

export const DB_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
export const ROUTINE_COLLECTION = process.env.NEXT_PUBLIC_APPWRITE_ROUTINE_COLLECTION!;
