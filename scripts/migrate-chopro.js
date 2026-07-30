// migrate-chopro.js — Convert .chopro files to compact format (2025-07-30)
// ============================================================================
// Old:   {start_of_chorus: Chorus 1} / {end_of_chorus}, @time=N @bar=N on every line
// New:   ## Chorus 1 @time, lines with @time, bare chords with / /
//
// Rules:
//   - Section headers:  ## Name @time   (time is optional)
//   - Lyric lines:        [Chord]text @N.N
//   - Bare chord lines:   /Chord1 Chord2/ @N.N  (or without @time if unsynced)
//   - Metadata stays:     {title: ...} etc.
//   - @bar=N stripped (derivable from @time + bpm)
//   - {end_of_*} directives removed
//   - Double spaces collapsed
//   - Lines with no content after cleaning are dropped

var fs = require("fs");
var path = require("path");

var SONGS_DIR = path.join(process.env.HOME, "ReaperSongs");

function parseOldFormat(text) {
  var directives = {};
  var sections = [];
  var rawLines = text.split("\n");

  var currentSection = null;
  var currentType = "verse";

  for (var i = 0; i < rawLines.length; i++) {
    var raw = rawLines[i].trimRight();

    // Empty line: flush current section if any content
    if (raw.trim() === "") continue;

    // Metadata directives: {title: ...}
    if (raw.trim().charAt(0) === "{" && raw.trim().indexOf("}") > -1) {
      var match = raw.trim().match(/^\{([^:]+):\s*(.+)\}$/);
      if (match) {
        var dname = match[1].trim().toLowerCase();
        var dval = match[2].trim();
        if (dname.indexOf("start_of_") === 0) {
          // Start of section
          currentType = dname.replace("start_of_", "").replace(/\s+/g, "_");
          currentSection = { type: currentType, label: dval, lines: [] };
          sections.push(currentSection);
        } else if (dname.indexOf("end_of_") === 0) {
          currentSection = null;
        } else {
          directives[dname] = dval;
        }
      }
      continue;
    }

    // Content line
    var timeAnnot = null;
    var barAnnot = null;
    var content = raw.trim();

    // Extract @time=N
    var timeMatch = content.match(/@time\s*=\s*([\d]+\.?\d*)\s*/i);
    if (timeMatch) {
      timeAnnot = parseFloat(timeMatch[1]);
      content = content.replace(/@time\s*=\s*[\d]+\.?\d*\s*/gi, "");
    }

    // Extract @bar=N
    var barMatch = content.match(/@bar\s*=\s*(\d+)\s*/i);
    if (barMatch) {
      barAnnot = parseInt(barMatch[1], 10);
      content = content.replace(/@bar\s*=\s*\d+\s*/gi, "");
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, " ").trim();

    if (!content && !timeAnnot) continue;

    var line = { text: content, time: timeAnnot };

    // Detect bare chord lines: content has only chord names (no lyric words)
    line.isBare = false;
    if (content) {
      // Remove bracket chords to check if anything remains
      var withoutChords = content.replace(/\[[^\]]+\]/g, "").trim();
      if (withoutChords === "") {
        // All bracket chords, no text — THIS is a lyric line with brackets
        line.isBare = false;
      } else {
        // Check if all remaining tokens are chord names
        var tokens = withoutChords.split(/\s+/);
        var chordRe = /^[A-G][b#]?(?:m|dim|aug|sus[24]|add\d+|maj7|maj9|m6|m7|m9|7|9|11|13|6)*(?:\/[A-G][b#]?)?$/;
        var allChords = true;
        for (var t = 0; t < tokens.length; t++) {
          if (tokens[t] && !chordRe.test(tokens[t])) {
            allChords = false;
            break;
          }
        }
        if (allChords && tokens.length > 0) {
          // PURE bare chord line — wraps in / /
          line.isBare = true;
          line.bareText = tokens.join(" ");
        }
      }
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      // Lines outside any section — create unnamed verse
      if (sections.length === 0 || sections[sections.length-1].type !== "verse" || sections[sections.length-1].label !== "") {
        sections.push({ type: "verse", label: "", lines: [] });
      }
      sections[sections.length-1].lines.push(line);
    }
  }

  return { directives: directives, sections: sections };
}

function sectionTypeFromOld(type) {
  var t = (type || "").toLowerCase();
  if (t.indexOf("chorus") >= 0) return "chorus";
  if (t.indexOf("verse") >= 0) return "verse";
  if (t.indexOf("solo") >= 0) return "solo";
  if (t.indexOf("bridge") >= 0) return "bridge";
  if (t.indexOf("intro") >= 0) return "intro";
  if (t.indexOf("outro") >= 0) return "outro";
  if (t.indexOf("interlude") >= 0) return "interlude";
  return "verse";
}

function secTypeFromLabel(label) {
  var t = (label || "").toLowerCase();
  if (t.indexOf("chorus") >= 0) return "chorus";
  if (t.indexOf("verse") >= 0) return "verse";
  if (t.indexOf("solo") >= 0) return "solo";
  if (t.indexOf("bridge") >= 0) return "bridge";
  if (t.indexOf("intro") >= 0) return "intro";
  if (t.indexOf("outro") >= 0) return "outro";
  return "verse";
}

function formatTime(t) {
  if (t === null || t === undefined) return null;
  // Keep 2 decimal places, strip trailing zeros
  return parseFloat(t.toFixed(2));
}

function toNewFormat(parsed) {
  var out = [];

  // Metadata directives (sorted for consistency)
  var dirOrder = ["title", "artist", "key", "bpm"];
  for (var di = 0; di < dirOrder.length; di++) {
    var k = dirOrder[di];
    if (parsed.directives[k]) {
      out.push("{" + k + ": " + parsed.directives[k] + "}");
    }
  }
  // Any remaining directives
  for (var k in parsed.directives) {
    if (dirOrder.indexOf(k) >= 0) continue;
    out.push("{" + k + ": " + parsed.directives[k] + "}");
  }
  out.push("");

  // Sections
  for (var si = 0; si < parsed.sections.length; si++) {
    var sec = parsed.sections[si];
    var label = sec.label || sec.type || "Verse";

    // Clean label: strip @duration, extra metadata
    label = label.replace(/@\w+\s*=\s*\S+/g, "").trim();
    if (!label) label = "Verse";

    // Find first timed line to get section start time
    var secTime = null;
    for (var li = 0; li < sec.lines.length; li++) {
      if (sec.lines[li].time !== null && sec.lines[li].time !== undefined) {
        secTime = sec.lines[li].time;
        break;
      }
    }

    var header = "## " + label;
    if (secTime !== null) {
      header += " @" + formatTime(secTime);
    }
    out.push(header);

    for (var li = 0; li < sec.lines.length; li++) {
      var line = sec.lines[li];
      if (!line.text && !line.time && !line.isBare) continue;

      var lineOut = "  ";

      if (line.isBare) {
        lineOut += "/" + line.bareText + "/";
      } else {
        lineOut += line.text;
      }

      if (line.time !== null && line.time !== undefined) {
        lineOut += " @" + formatTime(line.time);
      }

      out.push(lineOut);
    }

    out.push("");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function migrateFile(filePath) {
  var oldText = fs.readFileSync(filePath, "utf8");
  var parsed = parseOldFormat(oldText);
  var newText = toNewFormat(parsed);

  // Only write if content changed
  if (newText.trim() === oldText.trim()) {
    return false;
  }

  // Backup
  var bakPath = filePath.replace(/\.chopro$/, ".chopro.bak");
  fs.writeFileSync(bakPath, oldText, "utf8");

  // Write new
  fs.writeFileSync(filePath, newText, "utf8");
  return true;
}

// ── Main ──
var files = [];
function walk(dir) {
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i].name);
    if (entries[i].isDirectory()) {
      walk(full);
    } else if (entries[i].name === "song.chopro") {
      files.push(full);
    }
  }
}

walk(SONGS_DIR);
console.log("Found " + files.length + " .chopro files\n");

var changed = 0;
var unchanged = 0;
var errors = 0;

for (var i = 0; i < files.length; i++) {
  try {
    if (migrateFile(files[i])) {
      changed++;
      console.log("  converted: " + path.relative(SONGS_DIR, files[i]));
    } else {
      unchanged++;
    }
  } catch (e) {
    errors++;
    console.error("  ERROR: " + files[i] + " — " + e.message);
  }
}

console.log("\nDone. " + changed + " migrated, " + unchanged + " unchanged, " + errors + " errors.");
