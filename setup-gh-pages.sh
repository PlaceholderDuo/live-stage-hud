#!/bin/bash
# One-time setup: Initialize GitHub Pages repo for live-hud redirect.
# Creates a gh-pages/ directory that gets pushed to GitHub.
# Once pushed, enable GitHub Pages in repo Settings → Pages → Source: main / gh-pages

GH_USER="${1:-PlaceholderDuo}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_DIR"

# Create gh-pages directory with redirect page
mkdir -p gh-pages

cat > gh-pages/guest.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Guest Singer — Live Stage Lyrics</title>
<style>
  body {
    background: #000; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100vh; margin: 0;
    padding: 2rem; text-align: center;
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .spinner {
    border: 4px solid #333; border-top: 4px solid #4fc3f7;
    border-radius: 50%; width: 40px; height: 40px;
    animation: spin 1s linear infinite; margin: 1.5rem auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { color: #aaa; font-size: 0.85rem; }
  .error { color: #ff6b6b; display: none; }
</style>
</head>
<body>
  <h1>Live Stage Lyrics</h1>
  <div class="spinner" id="spinner"></div>
  <p id="status">Connecting to the show...</p>
  <p class="error" id="error">Could not connect. Make sure the show server is running.</p>

  <script>
    (function() {
      var TUNNEL_URL_FILE = 'tunnel-url.txt';
      var spinner = document.getElementById('spinner');
      var status = document.getElementById('status');
      var error = document.getElementById('error');

      function redirect(url) {
        if (!url) { fail(); return; }
        status.textContent = 'Connected! Opening lyrics...';
        window.location.replace(url.replace(/\/$/, '') + '/hud');
      }

      function fail() {
        spinner.style.display = 'none';
        error.style.display = 'block';
        status.textContent = 'The show may not be running yet.';
      }

      // Try to read tunnel URL from the repo (updated by TUI)
      fetch(TUNNEL_URL_FILE + '?t=' + Date.now())
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(url) {
          if (url && url.trim()) redirect(url.trim());
          else fail();
        })
        .catch(fail);

      // Timeout after 5s
      setTimeout(function() {
        if (error.style.display === 'none') fail();
      }, 5000);
    })();
  </script>
</body>
</html>
EOF

echo "# GitHub Pages — Live HUD Redirect" > gh-pages/README.md
echo "tunnel not running" > gh-pages/tunnel-url.txt

# Initialize git if needed
if [ ! -d ".git" ]; then
  git init
  git checkout -b main
  git add -A
  git commit -m "Initial commit: live stage HUD project"
  echo ""
  echo "Git repo initialized locally."
fi

# Check for remote
if ! git remote | grep -q origin; then
  echo ""
  echo "============================================================"
  echo " ONE-TIME SETUP REQUIRED:"
  echo ""
  echo " 1. Create the repo on GitHub:"
  echo "    https://github.com/new"
  echo "    Name: live-hud"
  echo "    Public"
  echo "    Do NOT add README (we already have one)"
  echo ""
  echo " 2. Then run:"
  echo "    git remote add origin git@github.com:$GH_USER/live-hud.git"
  echo "    git push -u origin main"
  echo ""
  echo " 3. Enable GitHub Pages:"
  echo "    Settings → Pages → Source: Deploy from a branch"
  echo "    Branch: main, Folder: /gh-pages"
  echo "    Your page will be at: https://$GH_USER.github.io/live-hud/guest.html"
  echo "============================================================"
else
  echo "Git remote already configured. Push with:  git push origin main"
fi

echo ""
echo "QR code target: https://$GH_USER.github.io/live-hud/guest.html"
echo "This URL NEVER changes. Update the redirect with the TUI (node tui/showman.js)."
