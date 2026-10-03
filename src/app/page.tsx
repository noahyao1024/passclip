import DropSite from "@/components/DropSite";
import prompt from "../../prompts/extract-to-passclip.txt";
import { signingAvailable } from "@/lib/pass/build";

export default function Home() {
  return <DropSite prompt={prompt} walletAvailable={signingAvailable(process.env)} development={process.env.NODE_ENV === "development"} />;
}
