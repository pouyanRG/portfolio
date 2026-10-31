import { redirect } from "next/navigation";

// Temporary: the create-next-app template is gone. Point the home page at the gallery.
export default function Home() {
  redirect("/work");
}