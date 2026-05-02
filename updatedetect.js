// Auto-update script for GitHub Pages / static sites
// Checks for new commits on the current branch and forces reload if updated

const GITHUB_USER = "randomidk2993";
const GITHUB_REPO = "chattesting";
const BRANCH = "main"; // change if needed
const CHECK_INTERVAL = 60000; // check every 60 seconds

let currentCommitSha = null;

// Get stored commit SHA
function getStoredCommit() {
    return localStorage.getItem("site_commit_sha");
}

// Store latest commit SHA
function setStoredCommit(sha) {
    localStorage.setItem("site_commit_sha", sha);
}

// Clear browser cache by forcing new asset requests
function bustCacheAndReload() {
    console.log("New update detected. Clearing cache and reloading...");

    // Clear service worker caches if available
    if ("caches" in window) {
        caches.keys().then(names => {
            names.forEach(name => caches.delete(name));
        });
    }

    // Force reload with cache busting query param
    const url = new URL(window.location.href);
    url.searchParams.set("cacheBust", Date.now());

    window.location.replace(url.toString());
}

// Check latest GitHub commit
async function checkForUpdates() {
    try {
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/commits/${BRANCH}`,
            { cache: "no-store" }
        );

        if (!response.ok) throw new Error("GitHub API error");

        const data = await response.json();
        const latestSha = data.sha;

        const storedSha = getStoredCommit();

        if (!storedSha) {
            setStoredCommit(latestSha);
            console.log("Initial commit SHA stored.");
            return;
        }

        if (storedSha !== latestSha) {
            setStoredCommit(latestSha);
            bustCacheAndReload();
        } else {
            console.log("No new updates.");
        }
    } catch (err) {
        console.error("Update check failed:", err);
    }
}

// Initial check
checkForUpdates();

// Repeat checks
setInterval(checkForUpdates, CHECK_INTERVAL);
