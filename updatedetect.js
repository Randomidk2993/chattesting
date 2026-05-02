/*
 Auto GitHub Pages update script for:
 https://randomidk2993.github.io/chattesting/

 Detects new commits to main branch
 Clears site storage/cache as much as browsers allow
 Reloads aggressively for:
 - Chrome
 - Edge
 - Safari (mobile focus)
*/

const GITHUB_USER = "randomidk2993";
const GITHUB_REPO = "chattesting";
const BRANCH = "main";
const CHECK_INTERVAL = 30000; // every 30 sec

function getStoredCommit() {
    return localStorage.getItem("site_commit_sha");
}

function setStoredCommit(sha) {
    localStorage.setItem("site_commit_sha", sha);
}

async function clearSiteData() {
    try {
        // Clear Cache API
        if ("caches" in window) {
            const names = await caches.keys();
            await Promise.all(names.map(name => caches.delete(name)));
        }

        // Remove service workers
        if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(reg => reg.unregister()));
        }

        // Clear storage
        localStorage.clear();
        sessionStorage.clear();

        // IndexedDB
        if (window.indexedDB && indexedDB.databases) {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name) indexedDB.deleteDatabase(db.name);
            }
        }

    } catch (err) {
        console.warn("Cache clear issue:", err);
    }
}

function reloadFresh() {
    const url = new URL(window.location.href);

    // Strong cache-busting params
    url.searchParams.set("_update", Date.now());
    url.searchParams.set("_cacheBust", Math.random().toString(36).substring(2));

    // Prevent Safari history cache
    window.location.replace(url.toString());
}

async function updateSite() {
    console.log("Update detected. Refreshing site...");
    await clearSiteData();

    // Safari delay
    setTimeout(() => {
        reloadFresh();
    }, 700);
}

async function checkForUpdates() {
    try {
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/commits/${BRANCH}`,
            {
                cache: "no-store",
                headers: {
                    "Accept": "application/vnd.github.v3+json"
                }
            }
        );

        if (!response.ok) throw new Error("GitHub API failed");

        const data = await response.json();
        const latestSha = data.sha;
        const storedSha = getStoredCommit();

        if (!storedSha) {
            setStoredCommit(latestSha);
            console.log("Initial commit saved.");
            return;
        }

        if (storedSha !== latestSha) {
            setStoredCommit(latestSha);
            await updateSite();
        }

    } catch (err) {
        console.error("Commit check failed:", err);
    }
}

// Safari back-forward cache prevention
window.addEventListener("pageshow", function(event) {
    if (event.persisted) {
        window.location.reload();
    }
});

// Start checking
checkForUpdates();
setInterval(checkForUpdates, CHECK_INTERVAL);
