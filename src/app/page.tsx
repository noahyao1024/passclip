import DropSite from "@/components/DropSite";
import prompt from "../../prompts/extract-to-passclip.txt";

export default function Home() {
  return <DropSite prompt={prompt} />;
}
