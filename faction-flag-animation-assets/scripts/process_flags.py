#!/usr/bin/env python3
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "assets/faction-flags/processed"
LAYERS = ROOT / "assets/faction-flags/layers"
UPLOAD = ROOT.parent / "upload"
SOURCES = {
  "pioneer": UPLOAD / "ChatGPT Image 2026년 8월 2일 오후 04_39_16 (1)(1).png",
  "central": UPLOAD / "ChatGPT Image 2026년 8월 2일 오후 04_39_16 (2)(1).png",
  "guardian": UPLOAD / "ChatGPT Image 2026년 8월 2일 오후 04_39_17 (3)(1).png",
  "balanced-reference": UPLOAD / "ChatGPT Image 2026년 8월 2일 오후 04_39_18 (4)(1).png",
}

def bbox(mask):
  ys, xs = np.where(mask)
  return None if not len(xs) else [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]

def polygon(size, points):
  image = Image.new("L", size, 0)
  ImageDraw.Draw(image).polygon(points, fill=255)
  return np.asarray(image) > 0

def save_layer(rgba, mask, path):
  out = rgba.copy()
  out[~mask, :3] = 0
  out[:, :, 3] = np.where(mask, out[:, :, 3], 0)
  Image.fromarray(out, "RGBA").save(path, optimize=True)

def inspect_source(path):
  rgba = np.asarray(Image.open(path).convert("RGBA")); h, w = rgba.shape[:2]
  border = np.concatenate([rgba[:24,:,:3].reshape(-1,3), rgba[-24:,:,:3].reshape(-1,3), rgba[:,:24,:3].reshape(-1,3), rgba[:,-24:,:3].reshape(-1,3)])
  magenta = border[(border[:,0]>180)&(border[:,2]>180)&(border[:,1]<70)]
  return {"size":[w,h],"alpha_channel":True,"alpha_range":[int(rgba[:,:,3].min()),int(rgba[:,:,3].max())],"fully_opaque":bool(np.all(rgba[:,:,3]==255)),"magenta_rgb_p01":np.percentile(magenta,1,axis=0).round().astype(int).tolist(),"magenta_rgb_median":np.median(magenta,axis=0).round().astype(int).tolist(),"magenta_rgb_p99":np.percentile(magenta,99,axis=0).round().astype(int).tolist()}

def split(name):
  rgba = np.asarray(Image.open(PROCESSED/f"{name}-transparent.png").convert("RGBA")); h,w=rgba.shape[:2]
  a=rgba[:,:,3]; fg=a>4; yy,xx=np.indices((h,w))
  cloth = fg & polygon((w,h),[(302,197),(1228,197),(1228,805),(302,805)])
  cloth &= ~(fg & (yy<207) & (xx<470))
  tassel = fg & (xx>=165)&(xx<=270)&(yy>=225)&(yy<=790)&~cloth
  base = fg & (xx>=206)&(xx<=370)&(yy>=928)&(yy<=1218)
  impact = fg & (yy>=944)&~base
  pole = fg & ~cloth & ~tassel & ~base & ~impact
  outdir=LAYERS/name; outdir.mkdir(parents=True,exist_ok=True)
  masks={"pole":pole,"cloth":cloth,"tassel":tassel,"base":base,"impact-remain":impact}
  for key,mask in masks.items(): save_layer(rgba,mask,outdir/f"{key}.png")
  box=bbox(a>12)
  return {"foreground_bbox":box,"margins":{"left":box[0],"top":box[1],"right":w-1-box[2],"bottom":h-1-box[3]},"transparent_pixels":int(np.count_nonzero(a==0)),"partial_alpha_pixels":int(np.count_nonzero((a>0)&(a<255))),"pole_top":[289,20],"landing_anchor":[289,1188],"ground_line_y":1188,"cloth_attachment":[310,220],"cloth_region":[302,197,1228,805],"impact_center":[289,1148],"layers":{k:bbox(v) for k,v in masks.items()}}

report={"sources":{k:inspect_source(v) for k,v in SOURCES.items()},"singles":{k:split(k) for k in ("pioneer","central","guardian")}}
boxes=[report["singles"][k]["foreground_bbox"] for k in ("pioneer","central","guardian")]
report["normalization"]={"canvas":[1254,1254],"common_anchor":[289,1188],"ground_line_y":1188,"cloth_attachment":[310,220],"bbox_max_delta_px":[max(v)-min(v) for v in zip(*boxes)],"resampling":False}
(ROOT/"inspection-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(report,ensure_ascii=False,indent=2))
