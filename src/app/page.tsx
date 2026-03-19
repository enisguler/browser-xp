import XPEmulator from "@/components/xp-emulator";
import { getDiskManifest } from "@/lib/xp-disk";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const manifest = await getDiskManifest();

  return (
    <main className={styles.page}>
      <XPEmulator manifest={manifest} />
    </main>
  );
}
