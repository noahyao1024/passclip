import DropSite from "@/components/DropSite";
import prompt from "../../prompts/extract-to-passclip.txt";
import { signingAvailable } from "@/lib/pass/build";
import { readStorageConfig } from "@/lib/storage/config";

export default function Home() {
  const storage = readStorageConfig(process.env);
  return <DropSite prompt={prompt} walletAvailable={signingAvailable(process.env)} development={process.env.NODE_ENV === "development"}
    uploads={storage.ok ? { publicUrl: storage.config.publicUrl } : undefined} />;
}
