"""
打包模块 — 验证、生成 monster_config.json、创建 ZIP。
"""
import os
import json
import zipfile

from PIL import Image

from .config import DIRS, ANIMS, COLS, FLIP_MAP, ANIM_META


def verify_direction(dir_path: str) -> dict:
    """
    检查一个方向目录是否完整。
    返回 {"ok": bool, "missing": [...], "files": int}。
    """
    missing = []
    files = 0
    for anim in ANIMS:
        strip = os.path.join(dir_path, f"{anim}.png")
        gif = os.path.join(dir_path, f"{anim}.gif")
        if not os.path.isfile(strip):
            missing.append(f"{anim}.png")
        else:
            files += 1
        if not os.path.isfile(gif):
            missing.append(f"{anim}.gif")
        else:
            files += 1
        for fi in range(4):
            fp = os.path.join(dir_path, "frames", f"{anim}_F{fi}.png")
            if not os.path.isfile(fp):
                missing.append(f"frames/{anim}_F{fi}.png")
            else:
                files += 1
    return {"ok": len(missing) == 0, "missing": missing, "files": files}


def verify_monster(base_dir: str) -> dict:
    """
    验证完整怪物输出目录。
    返回 {"ok": bool, "directions": {dir: verify_result}, "total_files": int}。
    """
    result = {"ok": True, "directions": {}, "total_files": 0}
    for d in DIRS:
        dp = os.path.join(base_dir, d)
        if not os.path.isdir(dp):
            result["directions"][d] = {"ok": False, "missing": ["整个目录缺失"], "files": 0}
            result["ok"] = False
        else:
            vr = verify_direction(dp)
            result["directions"][d] = vr
            result["total_files"] += vr["files"]
            if not vr["ok"]:
                result["ok"] = False
    return result


def get_cell_size(dir_path: str) -> tuple:
    """从 idle.png 推断单元格尺寸。"""
    idle_path = os.path.join(dir_path, "idle.png")
    if os.path.isfile(idle_path):
        img = Image.open(idle_path)
        return img.width // COLS, img.height
    return 0, 0


def build_config(monster_name: str, base_dir: str,
                 style: str = "CEL_2D",
                 morphology: str = "quadruped",
                 display_name: str = "",
                 description: str = "",
                 feature_lock: str = "") -> dict:
    """生成 monster_config.json 的内容。"""
    cell_sizes = {}
    for d in DIRS:
        cw, ch = get_cell_size(os.path.join(base_dir, d))
        if cw > 0:
            cell_sizes[d] = {"width": cw, "height": ch}

    return {
        "monster_id": monster_name,
        "display_name": display_name or monster_name,
        "description": description,
        "feature_lock": feature_lock,
        "pipeline": "TOPDOWN_5DIR_4FRAME",
        "style": style,
        "morphology": morphology,
        "anchor": "com-x_feet-y",
        "directions": {
            "generated": DIRS,
            "flip_x_map": FLIP_MAP,
        },
        "cell_sizes": cell_sizes,
        "animations": {
            anim: meta.copy() for anim, meta in ANIM_META.items()
        },
    }


def save_config(config: dict, base_dir: str) -> str:
    path = os.path.join(base_dir, "monster_config.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return path


def create_preview_html(monster_name: str, base_dir: str) -> str:
    """生成可交互的动画预览 HTML。"""
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{monster_name} 动画预览</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#1a1a2e;color:#e2e8f0;font-family:system-ui,sans-serif;padding:20px}}
h1{{text-align:center;color:#a855f7;margin-bottom:20px;font-size:20px}}
.controls{{text-align:center;margin-bottom:16px}}
.controls label{{color:#64748b;font-size:13px;margin-right:8px}}
.controls select,.controls input{{background:#222;border:1px solid #444;color:#fff;padding:4px 8px;border-radius:4px}}
.grid{{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-width:1200px;margin:0 auto}}
.cell{{background:#222;border-radius:8px;overflow:hidden;border:1px solid #333}}
.cell .hdr{{padding:6px 8px;font-size:11px;color:#a855f7;font-weight:600;border-bottom:1px solid #333;display:flex;justify-content:space-between}}
.cell canvas{{display:block;width:100%;image-rendering:pixelated;background:#1e1e1e}}
.section{{grid-column:1/-1;color:#a855f7;font-weight:700;padding:10px 0 4px;border-bottom:1px solid #333;margin-top:8px}}
</style>
</head>
<body>
<h1>{monster_name} 动画预览</h1>
<div class="controls">
  <label>速度:</label><input type="range" id="spd" min="1" max="20" value="8">
  <span id="spdV" style="color:#a855f7;font-weight:700;margin-left:4px">8 帧/秒</span>
  <label style="margin-left:16px">筛选:</label>
  <select id="flt"><option value="all">全部</option><option value="idle">站立</option><option value="walk">行走</option><option value="atk">攻击</option><option value="hit">受击</option><option value="die">死亡</option></select>
</div>
<div class="grid" id="grid"></div>
<script>
const D=['S','SE','E','NE','N'],A=['idle','walk','atk','hit','die'];
const CN={{idle:'站立',walk:'行走',atk:'攻击',hit:'受击',die:'死亡'}};
const DC={{S:'南',SE:'东南',E:'东',NE:'东北',N:'北'}};
let fps=8,cells=[],imgs={{}};
function build(){{
  const g=document.getElementById('grid');g.innerHTML='';cells=[];
  const f=document.getElementById('flt').value;
  const anims=f==='all'?A:[f];
  anims.forEach(a=>{{
    const s=document.createElement('div');s.className='section';s.textContent=CN[a];g.appendChild(s);
    D.forEach(d=>{{
      const c=document.createElement('div');c.className='cell';
      const h=document.createElement('div');h.className='hdr';h.innerHTML='<span>'+DC[d]+'</span><span class="fc">F0</span>';
      const cv=document.createElement('canvas');cv.width=200;cv.height=120;
      c.appendChild(h);c.appendChild(cv);g.appendChild(c);
      cells.push({{cv,d,a,fr:0,fc:h.querySelector('.fc')}});
      const k=d+'_'+a;
      if(!imgs[k]){{const im=new Image();im.src=d+'/'+a+'.png';im.onload=()=>imgs[k]=im;}}
    }});
  }});
}}
function tick(){{
  cells.forEach(c=>{{
    c.fr=(c.fr+1)%4;c.fc.textContent='F'+c.fr;
    const im=imgs[c.d+'_'+c.a];if(!im)return;
    const ctx=c.cv.getContext('2d');ctx.clearRect(0,0,c.cv.width,c.cv.height);
    const cw=im.width/4,ch=im.height;
    const sc=Math.min(c.cv.width/cw,c.cv.height/ch)*.9;
    const dw=cw*sc,dh=ch*sc,dx=(c.cv.width-dw)/2,dy=(c.cv.height-dh)/2;
    ctx.drawImage(im,c.fr*cw,0,cw,ch,dx,dy,dw,dh);
  }});
}}
let timer;
function start(){{clearInterval(timer);timer=setInterval(tick,1000/fps);}}
document.getElementById('spd').oninput=e=>{{fps=+e.target.value;document.getElementById('spdV').textContent=fps+' 帧/秒';start();}};
document.getElementById('flt').onchange=()=>build();
build();start();
</script>
</body>
</html>"""
    path = os.path.join(base_dir, "preview.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


def create_zip(base_dir: str, output_zip_path: str) -> str:
    """将整个怪物输出目录打包为 ZIP。"""
    base_name = os.path.basename(base_dir)
    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(base_dir):
            for file in files:
                full_path = os.path.join(root, file)
                arc_name = os.path.join(base_name, os.path.relpath(full_path, base_dir))
                zf.write(full_path, arc_name)
    return output_zip_path
