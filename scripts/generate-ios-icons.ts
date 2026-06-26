import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const iconSetDir = join(process.cwd(), "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset");
const sourceIcon = join(process.cwd(), "apps", "web", "public", "icons", "icon.svg");

const icons = [
  { idiom: "iphone", size: "20x20", scale: "2x", px: 40 },
  { idiom: "iphone", size: "20x20", scale: "3x", px: 60 },
  { idiom: "iphone", size: "29x29", scale: "2x", px: 58 },
  { idiom: "iphone", size: "29x29", scale: "3x", px: 87 },
  { idiom: "iphone", size: "40x40", scale: "2x", px: 80 },
  { idiom: "iphone", size: "40x40", scale: "3x", px: 120 },
  { idiom: "iphone", size: "60x60", scale: "2x", px: 120 },
  { idiom: "iphone", size: "60x60", scale: "3x", px: 180 },
  { idiom: "ipad", size: "20x20", scale: "1x", px: 20 },
  { idiom: "ipad", size: "20x20", scale: "2x", px: 40 },
  { idiom: "ipad", size: "29x29", scale: "1x", px: 29 },
  { idiom: "ipad", size: "29x29", scale: "2x", px: 58 },
  { idiom: "ipad", size: "40x40", scale: "1x", px: 40 },
  { idiom: "ipad", size: "40x40", scale: "2x", px: 80 },
  { idiom: "ipad", size: "76x76", scale: "1x", px: 76 },
  { idiom: "ipad", size: "76x76", scale: "2x", px: 152 },
  { idiom: "ipad", size: "83.5x83.5", scale: "2x", px: 167 },
  { idiom: "ios-marketing", size: "1024x1024", scale: "1x", px: 1024 }
] as const;

mkdirSync(iconSetDir, { recursive: true });

for (const file of readdirSync(iconSetDir)) {
  if (file.startsWith("AppIcon-")) {
    rmSync(join(iconSetDir, file));
  }
}

const renderDir = mkdtempSync(join(tmpdir(), "courtwatch-ios-icon-"));
const nativeSourceIcon = join(renderDir, "courtwatch-native-icon.svg");
writeFileSync(
  nativeSourceIcon,
  readFileSync(sourceIcon, "utf8").replace('<rect width="512" height="512" rx="96" fill="#07111f"/>', '<rect width="512" height="512" fill="#07111f"/>')
);

execFileSync("qlmanage", ["-t", "-s", "1024", "-o", renderDir, nativeSourceIcon], {
  stdio: "ignore"
});

const renderedIcon = join(renderDir, `${basename(nativeSourceIcon)}.png`);
if (!existsSync(renderedIcon)) {
  throw new Error(`Expected rendered icon at ${renderedIcon}`);
}

const images = icons.map((icon) => {
  const filename = `AppIcon-${icon.px}.png`;
  const output = join(iconSetDir, filename);
  if (icon.px === 1024) {
    copyFileSync(renderedIcon, output);
  } else {
    execFileSync("sips", ["-z", String(icon.px), String(icon.px), renderedIcon, "--out", output], {
      stdio: "ignore"
    });
  }
  return {
    filename,
    idiom: icon.idiom,
    scale: icon.scale,
    size: icon.size
  };
});

writeFileSync(
  join(iconSetDir, "Contents.json"),
  JSON.stringify(
    {
      images,
      info: {
        author: "xcode",
        version: 1
      }
    },
    null,
    2
  ) + "\n"
);
