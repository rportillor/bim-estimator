import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
// @ts-ignore - Three.js types issue with package exports
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { BIMTransformControls, type TransformResult } from "./transform-controls";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ZoomIn, ZoomOut, Home, Layers, Eye, EyeOff, AlertTriangle, Map as MapIcon } from "lucide-react";
import type { UnitSystem } from "./unit-utils";
import { MOORINGS_GRIDLINES } from "./moorings-grid-constants";

export interface ViewerProps {
  ifcUrl?: string;
  modelId?: string;
  onElementSelect?: (_e: SelectedElement|null) => void;
  unitSystem?: UnitSystem;
  showBothUnits?: boolean;
}

export interface SelectedElement {
  expressID?: number;
  type: string;
  name?: string;
  material?: string;
  dimensions?: { height?: number; width?: number; length?: number; depth?: number; thickness?: number };
  volume?: number;
  area?: number;
  storey?: string;
  sectionDesignation?: string;
  properties?: Record<string, any>;
}

// simple metric-only for now (keeps API)
const unitConversion = {
  length: (v:number)=>v, area:(v:number)=>v, volume:(v:number)=>v
};

/**
 * Detect whether a coordinate set is in millimetres or metres and return metres.
 *
 * EstimatorPro v15.4+ stores all coordinates in metres.
 * Elements generated before v15.4 may have coordinates in mm (values like 3000, 6000).
 * Heuristic: if any |x| or |y| > 500 → treat as mm → divide by 1000.
 * This keeps the viewer backward-compatible with pre-v15.4 data in the database.
 *
 * Threshold 500 m: no real building is 500 m wide on a single floor — safe cutoff.
 */
function coerceCoordToMetres(x: number, y: number, z: number): {x:number, y:number, z:number} {
  const maxXY = Math.max(Math.abs(x), Math.abs(y));
  if (maxXY > 500) {
    // Looks like millimetres — convert
    return { x: x / 1000, y: y / 1000, z: z / 1000 };
  }
  return { x, y, z };
}

/**
 * Detect whether a dimension value (width/height/depth) is in mm or m.
 * Threshold: > 50 likely mm (a 50 m room width would be exceptional).
 */
function coerceDimToMetres(v: number): number {
  return Math.abs(v) > 50 ? v / 1000 : v;
}

function getDims(e:any){
  // 🏗️ ENHANCED: Extract proper dimensions based on element type
  const geom = e?.geometry?.dimensions || {};
  const props = e?.properties?.dimensions || {};
  const type = (e.elementType || e.type || "").toLowerCase();
  
  if(type.includes('wall') && e.properties?.start && e.properties?.end) {
    // For walls: calculate length from start/end points, use properties for thickness/height
    const start = e.properties.start;
    const end = e.properties.end;
    const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    // Dimensions are in metres from real-qto-processor (it converts mm→m)
    const actualLength = coerceDimToMetres(length || geom.width || geom.length || 0);
    const actualHeight = coerceDimToMetres(props.height || geom.height || 0);
    const actualDepth = coerceDimToMetres(props.width || geom.depth || geom.width || 0);

    // Only render if we have real dimensions — no fake minimums
    if (actualLength <= 0 || actualHeight <= 0) return null;
    return {
      width:  Math.min(500, actualLength),
      height: Math.min(50,  actualHeight),
      depth:  Math.max(0.001, Math.min(5, actualDepth)), // depth can be thin but not zero (would crash BoxGeometry)
    };
  }

  // For other elements: coerce to metres (handles both mm and m values)
  let width  = coerceDimToMetres(Number(geom.width ?? geom.length ?? props.width ?? geom.x ?? 0));
  let height = coerceDimToMetres(Number(geom.height ?? props.height ?? geom.y ?? 0));
  let depth  = coerceDimToMetres(Number(geom.depth ?? props.depth ?? geom.z ?? 0));

  // Render even with partial dimensions — show what we have
  if ((!width || !isFinite(width)) && (!height || !isFinite(height)) && (!depth || !isFinite(depth))) {
    return null; // All three missing — truly empty element
  }
  width  = isFinite(width)  ? width  : 0;
  height = isFinite(height) ? height : 0;
  depth  = isFinite(depth)  ? depth  : 0;

  // Only render elements with real dimensions — no fake minimums
  if (width <= 0 && height <= 0 && depth <= 0) return null;
  width  = Math.min(500, Math.max(0, width));
  height = Math.min(50,  Math.max(0, height));
  depth  = Math.min(500, Math.max(0, depth));
  // At least 2 of 3 dimensions must be > 0 to be renderable
  const nonZero = (width > 0 ? 1 : 0) + (height > 0 ? 1 : 0) + (depth > 0 ? 1 : 0);
  if (nonZero < 2) return null;

  return { width, height, depth };
}

function _getRealLocation(e:any){
  const type = (e.elementType || e.type || "").toLowerCase();
  
  // 🏗️ WALLS: Use start/end midpoint for accurate positioning
  if(type.includes('wall') && e.properties?.start && e.properties?.end) {
    const start = e.properties.start;
    const end = e.properties.end;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    // Use Z from geometry if available, otherwise default
    const z = e?.geometry?.location?.realLocation?.z || 0;
    return { x: midX, y: midY, z: z };
  }
  
  // For other elements, use existing logic
  // Parse location if it's a JSON string
  let parsedLocation = null;
  if (typeof e?.location === 'string' && e.location !== '{}') {
    try {
      parsedLocation = JSON.parse(e.location);
    } catch {
      console.warn('Failed to parse location:', e.location);
    }
  }

  const p = e?.geometry?.location?.realLocation
        || e?.properties?.realLocation
        || e?.geometry?.location?.coordinates
        || parsedLocation
        || e?.location
        || {x:0,y:0,z:0};
  
  // Coerce to metres — v15.4+ stores metres; older DB rows may have mm
  return coerceCoordToMetres(Number(p.x||0), Number(p.y||0), Number(p.z||0));
}

// 🏗️ Grid detection function adapted from server-side analysis
function detectGridFromElements(elements: any[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  
  for (const e of elements) {
    const t = String(e?.elementType || "").toUpperCase();
    const props = e?.properties || {};
    
    // Parse location if it's a JSON string
    let parsedLocation = null;
    if (typeof e?.location === 'string' && e.location !== '{}') {
      try {
        parsedLocation = JSON.parse(e.location);
      } catch {
        console.warn('Failed to parse location:', e.location);
      }
    }
    
    const loc = e?.geometry?.location?.realLocation || parsedLocation || { x: 0, y: 0, z: 0 };
    
    // Use wall start/end points for grid detection
    if (t.includes("WALL") && props.start && props.end) {
      xs.push(props.start.x, props.end.x);
      ys.push(props.start.y, props.end.y);
    } 
    // Use column centers and add column width/depth boundaries
    else if (t.includes("COLUMN")) {
      xs.push(+loc.x || 0);
      ys.push(+loc.y || 0);
      // Add column boundaries if dimensions available
      const dims = e?.geometry?.dimensions;
      if (dims?.width && dims?.depth) {
        xs.push(loc.x - dims.width/2, loc.x + dims.width/2);
        ys.push(loc.y - dims.depth/2, loc.y + dims.depth/2);
      }
    }
    // Use other structural element centers
    else if (t.includes("BEAM") || t.includes("FOUNDATION")) {
      xs.push(+loc.x || 0);
      ys.push(+loc.y || 0);
    }
  }
  
  if (!xs.length || !ys.length) return { xs: [], ys: [] };
  
  // Cluster nearby values (1% of span tolerance)
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const epsX = Math.max(0.01 * (maxX - minX), 0.05);
  const epsY = Math.max(0.01 * (maxY - minY), 0.05);
  
  return { 
    xs: cluster1D(xs, epsX).sort((a,b) => a-b), 
    ys: cluster1D(ys, epsY).sort((a,b) => a-b) 
  };
}

// 1D clustering helper
function cluster1D(values: number[], eps: number): number[] {
  const sorted = [...values].sort((a,b) => a-b);
  const groups: number[][] = [];
  let current: number[] = [];
  
  for (const v of sorted) {
    if (!current.length || Math.abs(v - current[current.length-1]) <= eps) {
      current.push(v);
    } else {
      groups.push(current);
      current = [v];
    }
  }
  if (current.length) groups.push(current);
  
  return groups.map(group => group.reduce((a,b) => a+b, 0) / group.length);
}

// 📏 Create canvas-based dimension label
function createDimensionLabel(dims: any, elementType: string): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  canvas.width = 512;
  canvas.height = 256;
  
  // Clear background
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw border
  context.strokeStyle = '#333333';
  context.lineWidth = 2;
  context.strokeRect(0, 0, canvas.width, canvas.height);
  
  // Set text style
  context.fillStyle = '#333333';
  context.font = 'bold 32px Arial';
  context.textAlign = 'center';
  
  // Format dimensions based on element type
  let text: string;
  if (elementType.includes('wall')) {
    text = `L: ${dims.width.toFixed(1)}m\nH: ${dims.height.toFixed(1)}m\nT: ${dims.depth.toFixed(2)}m`;
  } else if (elementType.includes('column')) {
    text = `${dims.width.toFixed(1)}m × ${dims.depth.toFixed(1)}m\nH: ${dims.height.toFixed(1)}m`;
  } else {
    text = `${dims.width.toFixed(1)} × ${dims.height.toFixed(1)} × ${dims.depth.toFixed(1)}m`;
  }
  
  // Draw text lines
  const lines = text.split('\n');
  const lineHeight = 40;
  const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;
  
  lines.forEach((line, index) => {
    context.fillText(line, canvas.width / 2, startY + index * lineHeight);
  });
  
  // Create sprite with canvas texture
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, alphaTest: 0.5 });
  const sprite = new THREE.Sprite(spriteMaterial);
  
  return sprite;
}

// 📐 Create distance line with measurement label
function createDistanceLine(start: any, end: any, length: number): THREE.Group | null {
  const group = new THREE.Group();
  
  // Create line geometry
  const points = [
    new THREE.Vector3(start.x, 2, start.y), // Elevated for visibility
    new THREE.Vector3(end.x, 2, end.y)
  ];
  
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const lineMaterial = new THREE.LineBasicMaterial({ 
    color: 0xff6600, // Orange for distance lines
    linewidth: 3,
    transparent: true,
    opacity: 0.8
  });
  
  const line = new THREE.Line(lineGeometry, lineMaterial);
  group.add(line);
  
  // Add measurement text at midpoint
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  const lengthLabel = createMeasurementText(`${length.toFixed(2)}m`);
  if (lengthLabel) {
    lengthLabel.position.set(midX, midY + 2.5, midY);
    lengthLabel.scale.setScalar(0.8);
    group.add(lengthLabel);
  }
  
  return group;
}

// 📝 Create measurement text sprite
function createMeasurementText(text: string): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  canvas.width = 256;
  canvas.height = 64;
  
  // Background
  context.fillStyle = 'rgba(255, 102, 0, 0.9)'; // Orange background
  context.fillRect(0, 0, canvas.width, canvas.height);
  
  // Text
  context.fillStyle = 'white';
  context.font = 'bold 24px Arial';
  context.textAlign = 'center';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
  
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, alphaTest: 0.5 });
  return new THREE.Sprite(spriteMaterial);
}

/**
 * Create a small text sprite for grid-line labels and axis indicators.
 * Uses a canvas texture rendered as a THREE.Sprite so it always faces the camera.
 */
function createGridLabel(text: string, color: string = '#888888', fontSize: number = 28): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 128;
  canvas.height = 64;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  return new THREE.Sprite(material);
}

function getWallRotation(e:any) {
  // 🏗️ Calculate wall rotation from start/end points
  if(!e.properties?.start || !e.properties?.end) return 0;
  
  const start = e.properties.start;
  const end = e.properties.end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  return Math.atan2(dy, dx); // Rotation in radians
}

export default function Viewer3D({ modelId, onElementSelect }: ViewerProps){
  const mountRef = useRef<HTMLDivElement|null>(null);
  const three = useRef<{renderer:THREE.WebGLRenderer, scene:THREE.Scene, camera:THREE.PerspectiveCamera, controls:OrbitControls} | null>(null);
  const [ready,setReady]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [elementCount,setElementCount]=useState(0);
  const [attentionCount,setAttentionCount]=useState(0);
  const [isLoading,setIsLoading]=useState(false);
  // ── Storey / floor visibility state ───────────────────────────────────────
  const [storeys,setStoreys]=useState<Array<{
    id: string; name: string; elevation: number; elementCount: number;
    rfiFlag: boolean; elevationSource: string;
  }>>([]);
  const [visibleStoreys,setVisibleStoreys]=useState<Set<string>>(new Set());
  const [showFloorPanel,setShowFloorPanel]=useState(false);
  const loadAbortController = useRef<AbortController|null>(null);
  const renderGenRef = useRef<number>(0);
  const transformControls = useRef<BIMTransformControls|null>(null);
  const moveDebounceTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  // Building bounding box stored after each load so camera buttons can use it
  const buildingCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(21, -4.65, 9.95));
  const buildingSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(84, 5, 55));

  // ── Constraint-propagating move handler ──────────────────────────────────
  const handleElementMove = useCallback((result: TransformResult) => {
    if (!modelId || !result.elementId) return;
    // Debounce: only call API 200ms after last drag event
    if (moveDebounceTimer.current) clearTimeout(moveDebounceTimer.current);
    moveDebounceTimer.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const headers: Record<string,string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`/api/bim/models/${modelId}/elements/${result.elementId}/move`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            position: result.position,
            rotation: result.rotation,
          }),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.affectedElements || !three.current) return;

        // Update affected element meshes in the scene
        const { scene } = three.current;
        for (const [affectedId, newPos] of Object.entries(data.affectedElements)) {
          if (affectedId === result.elementId) continue; // already moved by gizmo
          const pos = newPos as { origin: {x:number;y:number;z:number}; rotation: number };
          // Find the mesh for this element in the scene
          scene.traverse((obj: THREE.Object3D) => {
            const elData = obj.userData?.element;
            if (elData && (elData.id === affectedId || elData.globalId === affectedId)) {
              // BIM Z-up → Three.js Y-up
              obj.position.set(pos.origin.x, pos.origin.z, pos.origin.y);
              obj.rotation.y = -(pos.rotation || 0);
            }
          });
        }
      } catch { /* non-blocking */ }
    }, 200);
  }, [modelId]);

  useEffect(()=>{
    if(!mountRef.current) return;
    const container = mountRef.current;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf7f7fb);
    const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(container.clientWidth, container.clientHeight||640); container.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(60, container.clientWidth/(container.clientHeight||640), 0.1, 50000);
    camera.position.set(10,8,10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping=true;
    
    // ✅ MOBILE FIX: Touch-friendly controls for mobile devices
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.zoomSpeed = 0.6;
    controls.panSpeed = 0.8;
    controls.rotateSpeed = 0.5;
    
    // ✅ iOS FIX: Force touch events and prevent conflicts
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    // Keyboard controls disabled for mobile
    controls.screenSpacePanning = false;
    
    // ✅ iOS Safari fix: Prevent default touch behaviors and enable better touch handling
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.userSelect = 'none';
    renderer.domElement.style.webkitUserSelect = 'none';
    (renderer.domElement.style as any).webkitTouchCallout = 'none';
    
    // Force touch event handling for iOS with gesture support
    const canvas = renderer.domElement;
    let lastTouchDistance = 0;
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const scale = distance / lastTouchDistance;
        if (scale !== 1) {
          camera.position.multiplyScalar(2 - scale);
          lastTouchDistance = distance;
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(10,20,10); scene.add(dl);
    
    // 🏗️ PLACEHOLDER GRIDS: Will be replaced with analysis-based grids
    const tempGrid = new THREE.GridHelper(50, 50, 0x333333, 0x666666); 
    tempGrid.name = "tempGrid";
    tempGrid.visible = false; // Hidden until real grids are created
    scene.add(tempGrid);
    
    const axes = new THREE.AxesHelper(5); axes.name="axes"; scene.add(axes);
    three.current = {renderer, scene, camera, controls};
    let id:number; const tick=()=>{controls.update(); renderer.render(scene,camera); id=requestAnimationFrame(tick)}; id=requestAnimationFrame(tick);
    const ro = new ResizeObserver(()=>{ if(!three.current||!mountRef.current) return; const w=mountRef.current.clientWidth,h=mountRef.current.clientHeight||640; camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h);});
    ro.observe(container);

    // ── Transform controls for constraint-propagating move ────────────────
    try {
      const tc = new BIMTransformControls(scene, camera, renderer.domElement, controls);
      tc.onTransformChange(handleElementMove);
      transformControls.current = tc;
    } catch { /* TransformControls may not load in some environments */ }

    // ── Raycaster click handler for element selection ──────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (ev: PointerEvent) => { pointerDownPos = { x: ev.clientX, y: ev.clientY }; };
    const onPointerUp = (ev: PointerEvent) => {
      // Only treat as click if pointer didn't move (not an orbit drag)
      const dx = ev.clientX - pointerDownPos.x;
      const dy = ev.clientY - pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObjects(scene.children, true);
      let hit: THREE.Intersection | null = null;
      for (const inter of intersects) {
        let obj: THREE.Object3D | null = inter.object;
        while (obj) {
          if (obj.userData?.element) { hit = inter; break; }
          obj = obj.parent;
        }
        if (hit) break;
      }

      if (hit) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !obj.userData?.element) obj = obj.parent;
        const elData = obj?.userData?.element;
        if (elData && onElementSelect) {
          const dims = elData.geometry?.dimensions || elData.properties?.dimensions || {};
          const quantities = elData.quantities || {};
          onElementSelect({
            expressID: undefined,
            type: elData.elementType || elData.type || 'Unknown',
            name: elData.name || elData.elementType,
            material: elData.material || elData.properties?.material,
            dimensions: {
              height: quantities.height || Number(dims.height) || undefined,
              width: quantities.width || Number(dims.width) || undefined,
              length: quantities.length || Number(dims.length) || undefined,
              depth: quantities.thickness || Number(dims.depth) || undefined,
              thickness: quantities.thickness || Number(dims.thickness) || undefined,
            },
            volume: quantities.volume || Number(elData.properties?.volume) || undefined,
            area: quantities.surfaceArea || Number(elData.properties?.area) || undefined,
            storey: elData.storeyName || elData.storey,
            sectionDesignation: elData.properties?.sectionDesignation || elData.properties?.profileName,
            properties: elData.properties,
          });
          // Attach transform gizmo to clicked element for constraint-propagating move
          if (obj && transformControls.current) {
            transformControls.current.attach(obj);
          }
        }
      } else {
        // Clicked empty space — detach gizmo and deselect
        if (transformControls.current) transformControls.current.detach();
        if (onElementSelect) onElementSelect(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    setReady(true);
    return ()=>{ cancelAnimationFrame(id); ro.disconnect(); renderer.domElement.removeEventListener('pointerdown', onPointerDown); renderer.domElement.removeEventListener('pointerup', onPointerUp); if(moveDebounceTimer.current) clearTimeout(moveDebounceTimer.current); if(transformControls.current) { transformControls.current.dispose(); transformControls.current=null; } renderer.dispose(); while(scene.children.length) scene.remove(scene.children[0]); container.removeChild(renderer.domElement); three.current=null; setReady(false); };
  },[]);

  // ── Fetch storey list whenever modelId changes ─────────────────────────────
  useEffect(()=>{
    if(!modelId) return;
    const token = localStorage.getItem("auth_token");
    const headers: Record<string,string> = { 'Content-Type': 'application/json' };
    if(token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/bim/models/${modelId}/storeys`, { credentials:'include', headers })
      .then(r=>r.ok ? r.json() : null)
      .then(data=>{
        if(!data || !Array.isArray(data.storeys)) return;
        setStoreys(data.storeys);
        // Default: all storeys visible
        setVisibleStoreys(new Set(data.storeys.map((s:any)=>s.name)));
      })
      .catch(()=>{ /* non-fatal — viewer still shows all elements */ });
  },[modelId]);

  useEffect(()=>{
    if(!ready || !modelId || !three.current || isLoading) return;
    
    // Cancel any previous load and assign a new render generation token.
    // The async closure captures renderGen and aborts if a newer render started.
    if(loadAbortController.current) {
      loadAbortController.current.abort();
    }
    loadAbortController.current = new AbortController();
    const renderGen = (renderGenRef.current = (renderGenRef.current ?? 0) + 1);
    
    const {scene,camera,controls} = three.current;
    // clear previous — remove everything except the initial GridHelper and AxesHelper.
    // This includes any previously rendered static gridlines (sg:*), element meshes,
    // labels, and debug objects. The static gridlines will be re-added at the end.
    for(let i=scene.children.length-1;i>=0;i--){
      const c = scene.children[i]; if(!(c instanceof THREE.GridHelper) && !(c instanceof THREE.AxesHelper)) scene.remove(c);
    }
    const root = new THREE.Group(); scene.add(root);

    (async ()=>{
      // Guard: if a newer render has started since this one, abort silently.
      if(renderGenRef.current !== renderGen) return;
      setIsLoading(true);
      // ✅ AUTHENTICATION FIX: Use proper auth token like rest of the app
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const res = await fetch(`/api/bim/models/${modelId}/elements?all=true`, {
        credentials: "include",
        headers,
        signal: loadAbortController.current?.signal
      }).catch(err => {
        if(err.name === 'AbortError') {
          console.log('BIM load cancelled');
          return null;
        }
        console.error('Failed to fetch BIM elements:', err);
        throw err;
      });
      
      if (!res) {
        setIsLoading(false);
        return; // Aborted
      }
      
      if (!res.ok) {
        console.error(`❌ Failed to load BIM elements: ${res.status} ${res.statusText}`);
        setIsLoading(false);
        return;
      }
      
      const json = await res.json();
      let elements = json.data || json.elements || json || [];
      
      // Performance optimization for mobile: limit elements
      const isMobile = window.innerWidth < 768;
      const maxElements = isMobile ? 1500 : 4000;
      
      if(elements.length > maxElements) {
        console.log(`⚡ Performance: Limiting display from ${elements.length} to ${maxElements} elements`);
        const priorityTypes = ['WALL', 'COLUMN', 'FLOOR', 'FLOOR_PLACEHOLDER'];
        const priorityElements = elements.filter((e:any) => 
          priorityTypes.includes((e.elementType || '').toUpperCase())
        );
        const otherElements = elements.filter((e:any) => 
          !priorityTypes.includes((e.elementType || '').toUpperCase())
        );
        elements = [...priorityElements.slice(0, maxElements * 0.8), ...otherElements.slice(0, maxElements * 0.2)];
      }

      // ── Floor visibility filter ─────────────────────────────────────────────
      // visibleStoreys is a Set<storeyName>. If it is populated (storeys were
      // loaded from the API) we only render elements whose storeyName is in the
      // set. Elements with no storeyName are always shown (they have no floor
      // assignment and hiding them would silently lose data).
      const currentVisible = visibleStoreys;
      if(currentVisible.size > 0) {
        elements = elements.filter((e:any) => {
          const sn = e.storeyName
            || e.properties?.storey?.name
            || e.properties?.storeyName
            || null;
          return sn === null || currentVisible.has(sn);
        });
      }
      // ─────────────────────────────────────────────────────────────────────────
      
      console.log(`🏗️ Loaded ${elements.length} BIM elements for display`);
      setElementCount(elements.length);
      setAttentionCount(elements.filter((e:any) =>
        e.properties?.rfi_flag || e.properties?.needs_attention
      ).length);
      setLoaded(true);
      
      // 🏗️ ELEMENT CONNECTIVITY: Group connected elements
      const wallConnections = new Map();
      const _mepConnections = new Map();
      
      // Build connectivity maps
      elements.forEach((el: any, idx: number) => {
        if(el.elementType === 'WALL' && el.properties?.start && el.properties?.end) {
          const startKey = `${el.properties.start.x},${el.properties.start.y}`;
          const endKey = `${el.properties.end.x},${el.properties.end.y}`;
          if(!wallConnections.has(startKey)) wallConnections.set(startKey, []);
          if(!wallConnections.has(endKey)) wallConnections.set(endKey, []);
          wallConnections.get(startKey).push({el, idx, isStart: true});
          wallConnections.get(endKey).push({el, idx, isStart: false});
        }
      });
      
      // 🏗️ ANALYSIS-BASED GRID DETECTION: Extract real grid lines from building analysis
      const gridAnalysis = detectGridFromElements(elements);
      console.log(`🏗️ Grid Analysis: ${gridAnalysis.xs.length} X-grid lines, ${gridAnalysis.ys.length} Y-grid lines`, {
        xLines: gridAnalysis.xs.slice(0, 10), // Show first 10 for debugging
        yLines: gridAnalysis.ys.slice(0, 10)
      });
      
      const _edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.25, transparent: true });
      const box = new THREE.Box3();

      // 🎯 COORDINATE TRANSFORMATION: Properly transform building coordinates to Three.js coordinate system
      // Building data: X=X, Y=depth, Z=height (vertical)
      // Three.js: X=X, Y=height (vertical), Z=depth
      let minZ = Infinity, maxZ = -Infinity;
      let minBuildingY = Infinity, maxBuildingY = -Infinity;
      const _rawCoords = elements.map((e: any) => {
        // Parse location if it's a JSON string
        let parsedLocation = null;
        if (typeof e?.location === 'string' && e.location !== '{}') {
          try {
            parsedLocation = JSON.parse(e.location);
          } catch {
            console.warn('Failed to parse location:', e.location);
          }
        }
        
        const rawP = e?.geometry?.location?.realLocation
              || e?.properties?.realLocation
              || e?.geometry?.location?.coordinates
              || parsedLocation
              || e?.location
              || {x:0,y:0,z:0};
        // Coerce to metres — backward compat with pre-v15.4 mm coordinates
        const cc = coerceCoordToMetres(Number(rawP.x||0), Number(rawP.y||0), Number(rawP.z||0));
        minZ = Math.min(minZ, cc.z);
        maxZ = Math.max(maxZ, cc.z);
        minBuildingY = Math.min(minBuildingY, cc.y);
        maxBuildingY = Math.max(maxBuildingY, cc.y);
        return cc;
      });
      
      // Normalize Z: detect absolute datums (e.g. 257.6m mASL) and convert to relative heights.
      // The offset is stored and applied to ALL coordinate reads throughout rendering.
      const zDatumOffset = Number.isFinite(minZ) && minZ > 50 ? minZ : 0; // >50m suggests absolute datum
      if (zDatumOffset !== 0) {
        for (const cc of _rawCoords) {
          cc.z -= zDatumOffset;
        }
        minZ -= zDatumOffset;
        maxZ -= zDatumOffset;
        console.log(`🏢 Z datum normalized: subtracted ${zDatumOffset.toFixed(2)}m (absolute datum → relative heights)`);
      }

      // Helper: coerce + apply datum offset (used for all mesh placements in this effect)
      const coerceWithDatum = (x: number, y: number, z: number) => {
        const cc = coerceCoordToMetres(x, y, z);
        cc.z -= zDatumOffset;
        return cc;
      };

      const yOffset = 0;
      console.log(`🎯 Coordinate system: Y offset=${yOffset.toFixed(1)}m, Building: Y=${minBuildingY.toFixed(1)}→${maxBuildingY.toFixed(1)}, Z=${minZ.toFixed(1)}→${maxZ.toFixed(1)}`);

      // ═══════════════════════════════════════════════════════════════════
      // HELPER: Create Three.js geometry from serialized mesh data
      // When the 3D geometry kernel has produced real mesh data, use it
      // instead of falling back to box approximations.
      // ═══════════════════════════════════════════════════════════════════
      function createMeshFromSerialized(meshData: any): THREE.BufferGeometry | null {
        if (!meshData || !meshData.vertices || !meshData.indices) return null;
        if (meshData.vertices.length < 9 || meshData.indices.length < 3) return null;

        try {
          const geo = new THREE.BufferGeometry();
          const verts = new Float32Array(meshData.vertices.length);
          // Axis swap: building Z-up → Three.js Y-up
          for (let i = 0; i < meshData.vertices.length; i += 3) {
            verts[i]     = meshData.vertices[i];     // X → X
            verts[i + 1] = meshData.vertices[i + 2]; // Z → Y (up)
            verts[i + 2] = meshData.vertices[i + 1]; // Y → Z (forward)
          }
          geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(meshData.indices), 1));
          if (meshData.normals && meshData.normals.length === meshData.vertices.length) {
            const norms = new Float32Array(meshData.normals.length);
            for (let i = 0; i < meshData.normals.length; i += 3) {
              norms[i]     = meshData.normals[i];
              norms[i + 1] = meshData.normals[i + 2];
              norms[i + 2] = meshData.normals[i + 1];
            }
            geo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
          } else {
            geo.computeVertexNormals();
          }
          geo.computeBoundingSphere();
          return geo;
        } catch (err) {
          console.warn('Failed to create mesh from serialized data:', err);
          return null;
        }
      }

      // Color map for real mesh elements
      function getMeshColor(type: string, material: string): number {
        const t = (type || '').toLowerCase();
        if (/exterior wall/.test(t)) return 0xC4A882;
        if (/interior wall|partition/.test(t)) return 0xE8DCC8;
        if (/curtain/.test(t)) return 0x88CCEE;
        if (/column/.test(t)) return 0x808080;
        if (/beam/.test(t)) return 0xA0A0A0;
        if (/slab|floor/.test(t)) return 0xD0D0D0;
        if (/roof/.test(t)) return 0x8B4513;
        if (/door/.test(t)) return 0x8B6914;
        if (/window/.test(t)) return 0x4FC3F7;
        if (/stair/.test(t)) return 0xB0B0B0;
        if (/footing|foundation/.test(t)) return 0x696969;
        if (/duct/.test(t)) return 0x4CAF50;
        if (/pipe/.test(t)) return 0x2196F3;
        if (/cable|tray/.test(t)) return 0xFF9800;
        if (/light/.test(t)) return 0xFFEB3B;
        if (/sprinkler/.test(t)) return 0xF44336;
        if (/panel/.test(t)) return 0x9C27B0;
        if (/railing/.test(t)) return 0x708090;
        return 0xCCCCCC;
      }

      let meshRenderedCount = 0;
      let boxFallbackCount = 0;

      for(const e of elements){
        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 1: Try to render from real mesh data (geometry kernel)
        // ═══════════════════════════════════════════════════════════════
        const meshData = e?.geometry?.mesh || e?.mesh;
        const realMeshGeo = createMeshFromSerialized(meshData);

        if (realMeshGeo) {
          const elType = e.type || e.elementType || '';
          const elMaterial = e.material || e.properties?.material || '';
          const color = getMeshColor(elType, elMaterial);
          const opacity = /window|glazing|curtain/i.test(elType) ? 0.4 : 1.0;
          const isTransparent = opacity < 1;

          const mat = new THREE.MeshStandardMaterial({
            color,
            metalness: /steel|metal|aluminum/i.test(elMaterial) ? 0.6 : 0.1,
            roughness: /glass|glazing/i.test(elMaterial) ? 0.1 : 0.85,
            flatShading: true,
            transparent: isTransparent,
            opacity,
          });

          const mesh = new THREE.Mesh(realMeshGeo, mat);

          // Add edges for visual clarity
          if (!isTransparent) {
            const edges = new THREE.EdgesGeometry(realMeshGeo, 30);
            const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.15, transparent: true });
            mesh.add(new THREE.LineSegments(edges, edgeMat));
          }

          mesh.userData = { element: e };
          root.add(mesh);
          meshRenderedCount++;

          // Expand bounding box
          realMeshGeo.computeBoundingBox();
          if (realMeshGeo.boundingBox) {
            box.expandByPoint(realMeshGeo.boundingBox.min);
            box.expandByPoint(realMeshGeo.boundingBox.max);
          }
          continue; // Skip legacy box rendering
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 2: Parametric profile rendering
        // When geometry-upgrade.ts has resolved real profiles (steel
        // sections, wall assemblies, column shapes, MEP shapes), render
        // them as proper Three.js geometry instead of bounding boxes.
        // This is what makes a BIM viewer look like Revit/Navisworks.
        // ═══════════════════════════════════════════════════════════════
        const profile = e?.geometry?.profile;
        const assembly = e?.geometry?.assembly;
        if (profile || assembly) {
          const dims2 = getDims(e);
          if (dims2) {
            let parsedLoc2 = null;
            if (typeof e?.location === 'string' && e.location !== '{}') {
              try { parsedLoc2 = JSON.parse(e.location); } catch {}
            }
            const rawLoc2 = e?.geometry?.location?.realLocation
              || e?.properties?.realLocation
              || e?.geometry?.location?.coordinates
              || parsedLoc2 || e?.location || {x:0,y:0,z:0};
            const cc3 = coerceWithDatum(
              Number(rawLoc2.x || 0), Number(rawLoc2.y || 0), Number(rawLoc2.z || 0)
            );
            const pp = { x: cc3.x, y: cc3.z, z: cc3.y }; // BIM Z-up → Three.js Y-up
            const elType2 = (e.elementType || e.type || e.category || '').toLowerCase();
            const yaw = e?.geometry?.orientation?.yawRad || 0;

            let profileGeo: THREE.BufferGeometry | null = null;
            let profileColor = 0xCCCCCC;
            let profileMatProps: any = { metalness: 0.1, roughness: 0.85, flatShading: true };

            // ── I-BEAM / W-SECTION PROFILES ──────────────────────────────
            if (profile?.shape === 'w-section' || profile?.shape === 'i_beam') {
              const d = profile.depth || dims2.height || 0.3;    // total depth
              const bf = profile.flangeWidth || dims2.width || 0.15; // flange width
              const tw = profile.webThickness || d * 0.04;       // web thickness
              const tf = profile.flangeThickness || d * 0.06;    // flange thickness
              const beamLength = dims2.depth || dims2.width || 3; // span length

              // Build I-beam cross-section as a THREE.Shape
              const shape = new THREE.Shape();
              const hw = bf / 2;   // half flange width
              const hd = d / 2;    // half depth
              const htw = tw / 2;  // half web thickness

              // Outer I shape: start at bottom-left of bottom flange
              shape.moveTo(-hw, -hd);
              shape.lineTo(hw, -hd);
              shape.lineTo(hw, -hd + tf);
              shape.lineTo(htw, -hd + tf);
              shape.lineTo(htw, hd - tf);
              shape.lineTo(hw, hd - tf);
              shape.lineTo(hw, hd);
              shape.lineTo(-hw, hd);
              shape.lineTo(-hw, hd - tf);
              shape.lineTo(-htw, hd - tf);
              shape.lineTo(-htw, -hd + tf);
              shape.lineTo(-hw, -hd + tf);
              shape.closePath();

              const extrudeSettings = { steps: 1, depth: beamLength, bevelEnabled: false };
              profileGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
              // Extrude goes along Z; rotate so beam runs along X
              profileGeo.rotateY(Math.PI / 2);
              profileGeo.translate(0, hd, 0); // bottom of beam at origin
              profileColor = 0x708090; // steel gray
              profileMatProps = { metalness: 0.65, roughness: 0.35, flatShading: true };
            }

            // ── HSS RECTANGULAR SECTIONS ─────────────────────────────────
            else if (profile?.shape === 'hss-rect' || profile?.shape === 'hollow_rectangular') {
              const d = profile.depth || dims2.height || 0.2;
              const w = profile.outerWidth || profile.flangeWidth || dims2.width || 0.2;
              const wt = profile.wallThickness || 0.008;
              const beamLength = dims2.depth || dims2.width || 3;

              const outer = new THREE.Shape();
              outer.moveTo(-w/2, -d/2);
              outer.lineTo(w/2, -d/2);
              outer.lineTo(w/2, d/2);
              outer.lineTo(-w/2, d/2);
              outer.closePath();

              const hole = new THREE.Path();
              const iw = w/2 - wt, id = d/2 - wt;
              hole.moveTo(-iw, -id);
              hole.lineTo(iw, -id);
              hole.lineTo(iw, id);
              hole.lineTo(-iw, id);
              hole.closePath();
              outer.holes.push(hole);

              profileGeo = new THREE.ExtrudeGeometry(outer, { steps: 1, depth: beamLength, bevelEnabled: false });
              profileGeo.rotateY(Math.PI / 2);
              profileGeo.translate(0, d/2, 0);
              profileColor = 0x708090;
              profileMatProps = { metalness: 0.65, roughness: 0.35, flatShading: true };
            }

            // ── HSS ROUND / PIPE SECTIONS ────────────────────────────────
            else if (profile?.shape === 'hss-round' || profile?.shape === 'pipe') {
              const outerR = (profile.depth || profile.diameter || dims2.width || 0.1) / 2;
              const wt = profile.wallThickness || outerR * 0.1;
              const innerR = Math.max(outerR - wt, outerR * 0.5);
              const pipeLen = Math.max(dims2.depth, dims2.height, dims2.width, 0.5);

              // Outer cylinder minus inner = hollow pipe
              profileGeo = new THREE.CylinderGeometry(outerR, outerR, pipeLen, 16);
              profileColor = /plumb|water|copper/i.test(elType2) ? 0xB87333 : 0x808080;
              profileMatProps = { metalness: 0.7, roughness: 0.3, flatShading: false };
            }

            // ── CYLINDRICAL COLUMNS ──────────────────────────────────────
            else if (profile?.shape === 'circular' && /column|pillar|pier/i.test(elType2)) {
              const diameter = profile.diameter || dims2.width || 0.4;
              const h = dims2.height || 3;
              profileGeo = new THREE.CylinderGeometry(diameter/2, diameter/2, h, 16);
              profileGeo.translate(0, h/2, 0);
              profileColor = 0x808080;
              profileMatProps = { metalness: 0.5, roughness: 0.5, flatShading: false };
            }

            // ── CIRCULAR PIPES / CONDUITS ──────────────────────────────────
            else if (profile?.type === 'pipe' || (profile?.shape === 'circular' && /pipe|conduit|sprinkler/i.test(elType2))) {
              const diam = profile.diameter || dims2.width || 0.05;
              const pipeLen = Math.max(dims2.depth, dims2.height, dims2.width, 0.5);
              profileGeo = new THREE.CylinderGeometry(diam/2, diam/2, pipeLen, 12);
              profileGeo.rotateZ(Math.PI / 2); // horizontal
              profileColor = /plumb|water|copper|hot|cold/i.test(elType2) ? 0xB87333 : 0x808080;
              profileMatProps = { metalness: 0.7, roughness: 0.3, flatShading: false };
            }

            // ── CIRCULAR DUCTS ───────────────────────────────────────────
            else if (profile?.shape === 'circular' && /duct/i.test(elType2)) {
              const diam = profile.diameter || dims2.width || 0.3;
              const ductLen = Math.max(dims2.depth, dims2.height, 1);
              profileGeo = new THREE.CylinderGeometry(diam/2, diam/2, ductLen, 12);
              profileGeo.rotateZ(Math.PI / 2); // horizontal orientation
              profileColor = 0xA9A9A9;
              profileMatProps = { metalness: 0.7, roughness: 0.4, flatShading: false };
            }

            // ── RECTANGULAR DUCTS (with visible thickness) ───────────────
            else if (profile?.shape === 'rectangular' && /duct/i.test(elType2)) {
              const dw = profile.width || dims2.width || 0.6;
              const dh = profile.height || dims2.depth || 0.3;
              const wt2 = 0.002; // sheet metal thickness
              const ductLen = Math.max(dims2.depth, dims2.height, 1);

              const outer = new THREE.Shape();
              outer.moveTo(-dw/2, -dh/2);
              outer.lineTo(dw/2, -dh/2);
              outer.lineTo(dw/2, dh/2);
              outer.lineTo(-dw/2, dh/2);
              outer.closePath();

              const inner = new THREE.Path();
              inner.moveTo(-dw/2 + wt2, -dh/2 + wt2);
              inner.lineTo(dw/2 - wt2, -dh/2 + wt2);
              inner.lineTo(dw/2 - wt2, dh/2 - wt2);
              inner.lineTo(-dw/2 + wt2, dh/2 - wt2);
              inner.closePath();
              outer.holes.push(inner);

              profileGeo = new THREE.ExtrudeGeometry(outer, { steps: 1, depth: ductLen, bevelEnabled: false });
              profileGeo.rotateY(Math.PI / 2);
              profileColor = 0xA9A9A9;
              profileMatProps = { metalness: 0.7, roughness: 0.4, flatShading: true };
            }

            // ── CABLE TRAY (U-channel) ───────────────────────────────────
            else if (profile?.shape === 'u_channel') {
              const tw2 = profile.width || dims2.width || 0.3;
              const td = profile.depth || dims2.depth || 0.1;
              const wt3 = 0.003;
              const trayLen = Math.max(dims2.height, dims2.depth, 1);

              const shape = new THREE.Shape();
              // U-channel: bottom + two sides (open top)
              shape.moveTo(-tw2/2, 0);
              shape.lineTo(tw2/2, 0);
              shape.lineTo(tw2/2, td);
              shape.lineTo(tw2/2 - wt3, td);
              shape.lineTo(tw2/2 - wt3, wt3);
              shape.lineTo(-tw2/2 + wt3, wt3);
              shape.lineTo(-tw2/2 + wt3, td);
              shape.lineTo(-tw2/2, td);
              shape.closePath();

              profileGeo = new THREE.ExtrudeGeometry(shape, { steps: 1, depth: trayLen, bevelEnabled: false });
              profileGeo.rotateY(Math.PI / 2);
              profileColor = 0xFF9800;
              profileMatProps = { metalness: 0.5, roughness: 0.5, flatShading: true };
            }

            // ── MULTI-LAYER WALL ASSEMBLIES ──────────────────────────────
            else if (assembly && assembly.layers && /wall|partition/i.test(elType2)) {
              const wallLen = Math.max(dims2.width, dims2.depth, 1);
              const wallH = dims2.height || 3;
              const layers: { name: string; thickness: number; material: string; isStructural: boolean }[] = assembly.layers;

              // Build each layer as a separate colored box
              const wallGroup = new THREE.Group();
              let currentOffset = 0;
              const totalThk = assembly.totalThickness || layers.reduce((s: number, l: any) => s + l.thickness, 0);

              for (const layer of layers) {
                const layerThk = layer.thickness;
                const layerGeo = new THREE.BoxGeometry(wallLen, wallH, layerThk);
                const layerZ = -totalThk / 2 + currentOffset + layerThk / 2;
                layerGeo.translate(0, wallH / 2, layerZ);

                // Color by material type
                let layerColor = 0xE8DCC8; // default beige
                const mat = (layer.material || '').toLowerCase();
                if (/brick/.test(mat)) layerColor = 0xB22222;
                else if (/steel|metal|aluminum/.test(mat)) layerColor = 0x708090;
                else if (/gypsum|drywall/.test(mat)) layerColor = 0xFAF0E6;
                else if (/insulation|batt|mineral|xps/.test(mat)) layerColor = 0xFFFF99;
                else if (/concrete|cmu|masonry/.test(mat)) layerColor = 0x808080;
                else if (/osb|sheathing|plywood/.test(mat)) layerColor = 0xDEB887;
                else if (/air/.test(mat)) { currentOffset += layerThk; continue; } // skip air cavities
                else if (/polyethylene|vapor|barrier/.test(mat)) layerColor = 0x4169E1;

                const layerMat = new THREE.MeshStandardMaterial({
                  color: layerColor,
                  metalness: layer.isStructural ? 0.4 : 0.1,
                  roughness: 0.7,
                  flatShading: true,
                });
                const layerMesh = new THREE.Mesh(layerGeo, layerMat);

                // Add thin edges between layers for visual separation
                const edgesGeo = new THREE.EdgesGeometry(layerGeo, 30);
                const edgeMat2 = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.1, transparent: true });
                layerMesh.add(new THREE.LineSegments(edgesGeo, edgeMat2));

                wallGroup.add(layerMesh);
                currentOffset += layerThk;
              }

              // Position and rotate the wall group
              wallGroup.position.set(pp.x, pp.y, pp.z);
              wallGroup.rotation.y = -yaw; // yaw in BIM → Y rotation in Three.js
              wallGroup.userData = { element: e };
              root.add(wallGroup);

              // Expand bounding box
              const tmpBox = new THREE.Box3().setFromObject(wallGroup);
              box.expandByPoint(tmpBox.min);
              box.expandByPoint(tmpBox.max);
              meshRenderedCount++;
              continue; // skip box fallback
            }

            // ── SQUARE/RECTANGULAR COLUMN PROFILES ───────────────────────
            else if (profile?.shape === 'square' && /column|pillar/i.test(elType2)) {
              const side = profile.side || dims2.width || 0.4;
              const h = dims2.height || 3;
              profileGeo = new THREE.BoxGeometry(side, h, side);
              profileGeo.translate(0, h/2, 0);
              profileColor = 0x808080;
              profileMatProps = { metalness: 0.4, roughness: 0.6, flatShading: true };
            }

            else if (profile?.shape === 'rectangular' && /column|pillar/i.test(elType2)) {
              const cw = profile.width || dims2.width || 0.4;
              const cd = profile.depth || dims2.depth || 0.3;
              const h = dims2.height || 3;
              profileGeo = new THREE.BoxGeometry(cw, h, cd);
              profileGeo.translate(0, h/2, 0);
              profileColor = 0x808080;
              profileMatProps = { metalness: 0.4, roughness: 0.6, flatShading: true };
            }

            // ── RENDER THE PROFILE GEOMETRY ──────────────────────────────
            if (profileGeo) {
              const mat = new THREE.MeshStandardMaterial({ color: profileColor, ...profileMatProps });
              const mesh = new THREE.Mesh(profileGeo, mat);
              mesh.position.set(pp.x, pp.y, pp.z);
              mesh.rotation.y = -yaw;

              // Add subtle edges for visual definition
              if (!profileMatProps.transparent) {
                const edges = new THREE.EdgesGeometry(profileGeo, 25);
                const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.12, transparent: true });
                mesh.add(new THREE.LineSegments(edges, edgeMat));
              }

              mesh.userData = { element: e };
              root.add(mesh);
              meshRenderedCount++;

              // Expand bounding box
              profileGeo.computeBoundingBox();
              if (profileGeo.boundingBox) {
                const worldMin = profileGeo.boundingBox.min.clone().add(new THREE.Vector3(pp.x, pp.y, pp.z));
                const worldMax = profileGeo.boundingBox.max.clone().add(new THREE.Vector3(pp.x, pp.y, pp.z));
                box.expandByPoint(worldMin);
                box.expandByPoint(worldMax);
              }
              continue; // Skip legacy box fallback
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // FALLBACK: Legacy box-based rendering (pre-geometry-kernel data)
        // ═══════════════════════════════════════════════════════════════
        boxFallbackCount++;
        const dims = getDims(e);
        if (!dims) continue; // TS18047 fix: getDims returns null when dimensions missing — skip element

        // Get raw location and parse if needed
        let parsedLocation = null;
        if (typeof e?.location === 'string' && e.location !== '{}') {
          try {
            parsedLocation = JSON.parse(e.location);
          } catch {
            // Ignore parse errors
          }
        }

        const rawLocation = e?.geometry?.location?.realLocation
              || e?.properties?.realLocation
              || e?.geometry?.location?.coordinates
              || parsedLocation
              || e?.location
              || {x:0,y:0,z:0};

        // Coerce to metres + apply datum offset, then axis-swap for Three.js
        const cc2 = coerceWithDatum(
          Number(rawLocation.x || 0),
          Number(rawLocation.y || 0),
          Number(rawLocation.z || 0)
        );
        const p = {
          x: cc2.x,
          y: cc2.z,   // Building Z (height/elevation) → Three.js Y (up)
          z: cc2.y    // Building Y (depth/north-south) → Three.js Z (forward)
        };
        const type = (e.elementType || e.type || e.category || "").toLowerCase();

        // 🔍 DEBUG: Log element types to see what we're working with
        if(Math.random() < 0.001) console.log(`🏗️ Element type: "${e.elementType}" → "${type}"`);

        // ══════════════════════════════════════════════════════════════════
        // STRUCTURAL GRID LINES — rendered as real THREE.Line objects
        // Coordinate convention (parseLayerResponse):
        //   realLocation.x → Three.js X (east-west)
        //   realLocation.y → Three.js Z (north-south)   ← plan depth
        //   realLocation.z → Three.js Y (elevation)     ← up axis
        // ══════════════════════════════════════════════════════════════════
        if (type === 'grid_line') {
          // Grid lines are rendered from hardcoded constants (MOORINGS_GRIDLINES) in the static
          // grid section below — no DB dependency needed. Skip DB-driven rendering here.
          continue;
        }

        // 🏗️ COMPREHENSIVE BOQ ELEMENT DETECTION
        // Basic Structure
        const isWall = /(wall|partition|curtain)/.test(type);
        const isExteriorWall = /(exterior|facade|external)/.test(type) || (isWall && /(exterior|facade|external)/.test(e?.properties?.material || e?.material || ""));
        const isInteriorWall = isWall && !isExteriorWall;
        const isColumn = /(column|pillar|post)/.test(type);
        const isBeam = /(beam|girder|joist)/.test(type);
        const isFoundation = /(foundation|footing|basement|slab|grade)/.test(type);
        
        // Floors & Slabs
        const isSlab = /(slab|floor|deck)/.test(type);
        const isFloor = /(floor)/.test(type);
        const isRoof = /(roof|roofing)/.test(type);
        
        // Openings & Doors/Windows
        const isDoor = /(door|entrance|exit|portal)/.test(type);
        const isWindow = /(window|glazing|curtain.wall)/.test(type);
        const _isOpening = isDoor || isWindow || /(opening|aperture)/.test(type);
        
        // Vertical Transportation & Circulation
        const isStair = /(stair|step|riser|tread|flight)/.test(type);
        const isRailing = /(railing|handrail|guardrail|balustrade)/.test(type);
        const isElevator = /(elevator|lift)/.test(type);
        const isEscalator = /(escalator|moving.walk)/.test(type);
        const _isVerticalTransport = isElevator || isEscalator;
        
        // MEP Systems
        const isHVAC = /(hvac|duct|air|ventilation|fan|vav|ahu)/.test(type);
        const isPlumbing = /(plumbing|pipe|water|drain|sewer)/.test(type);
        const isElectrical = /(electrical|conduit|cable|wire|panel|transformer)/.test(type);
        const isMEP = isHVAC || isPlumbing || isElectrical;
        
        // Lighting & Fire Safety
        const isLight = /(light|lighting|fixture|lamp|luminaire)/.test(type);
        const isSprinkler = /(sprinkler|fire|safety|alarm)/.test(type);
        const isReceptacle = /(receptacle|outlet|socket|switch)/.test(type);
        
        // Kitchen & Bathroom Fixtures  
        const isBathroom = /(toilet|sink|basin|shower|bath|tub|urinal|bidet)/.test(type);
        const isKitchen = /(kitchen|cabinet|range|oven|dishwasher|refrigerator)/.test(type);
        const isCounter = /(counter|countertop|worktop|island)/.test(type);
        const _isFixture = isBathroom || isKitchen || /(fixture|appliance)/.test(type);
        
        // Furniture & Equipment
        const isFurniture = /(furniture|desk|chair|table|bed|sofa|shelf)/.test(type);
        const isEquipment = /(equipment|machine|motor|pump|unit)/.test(type);
        
        // Site Work & Exterior
        const isLandscaping = /(landscape|plant|tree|shrub|grass|garden)/.test(type);
        const isDrainage = /(drainage|drain|gutter|downspout|catch.basin)/.test(type);
        const isPaving = /(paving|asphalt|concrete.slab|sidewalk|driveway|parking)/.test(type);
        const isUtility = /(utility|gas|water.main|sewer.main|electrical.service)/.test(type);
        const _isSiteWork = isLandscaping || isDrainage || isPaving || isUtility;
        
        // Interior Components & Finishes
        const isPartition = /(partition|drywall|gypsum|glass.partition)/.test(type);
        const isCeiling = /(ceiling|suspended|drop|acoustic)/.test(type);
        const isFlooring = /(flooring|tile|carpet|hardwood|vinyl|laminate)/.test(type);
        const isPaint = /(paint|coating|finish)/.test(type);
        const isMillwork = /(millwork|trim|molding|baseboard|crown)/.test(type);
        const isFinish = isFlooring || isPaint || isMillwork || /(finish)/.test(type);
        const _isInsulation = /(insulation|thermal|vapor|barrier)/.test(type);
        
        // Exterior Wall Materials
        const isBrick = /(brick|masonry|stone|granite|limestone)/.test(type);
        const isSiding = /(siding|cladding|vinyl|aluminum|wood.siding)/.test(type);
        const isCurtainWall = /(curtain.wall|glass.wall|storefront)/.test(type);
        const _isExteriorFinish = isBrick || isSiding || isCurtainWall;
        
        // Structural Elements
        const isStruct = isColumn || isBeam || isFoundation || /(structural|frame|truss)/.test(type);

        let geo:THREE.BufferGeometry;
        let color: number;
        let materialProps: any = { metalness:0.1, roughness:0.85, flatShading:true };

        if(isExteriorWall){
          // Exterior Walls: Thicker, darker for weatherproofing
          const length = Math.max(dims.width, dims.depth);
          const thick  = Math.min(dims.width, dims.depth, 0.4); // Thicker exterior walls
          geo = new THREE.BoxGeometry(length, dims.height, thick);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0xD2B48C; // Tan/brown for exterior walls
          materialProps.roughness = 0.9; // More textured
        } else if(isInteriorWall){
          // Interior Walls: Thinner, lighter color
          const length = Math.max(dims.width, dims.depth);
          const thick  = Math.min(dims.width, dims.depth, 0.25); // Thinner interior walls
          geo = new THREE.BoxGeometry(length, dims.height, thick);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0xF5F5DC; // Light beige for interior walls
        } else if(isFoundation){
          // Foundation: Thick, dark concrete
          const thick = Math.max(dims.height, 0.4); // Substantial foundation
          geo = new THREE.BoxGeometry(dims.width, thick, dims.depth);
          geo.translate(0, thick/2, 0); // Bottom edge at origin
          color = 0x696969; // Dark gray for foundation
          materialProps.roughness = 0.95;
        } else if(isSlab || isFloor){
          // Floor slabs: Wide, thin geometry, lighter than foundation
          const thick = Math.min(dims.height, 0.25); // Typical slab thickness
          geo = new THREE.BoxGeometry(dims.width, thick, dims.depth);
          geo.translate(0, thick/2, 0); // Bottom edge at origin
          color = 0xE6E6FA; // Light lavender for floor slabs
          materialProps.roughness = 0.8;
        } else if(isRoof){
          // Roof: Similar to floor but different color
          const thick = Math.min(dims.height, 0.4);
          geo = new THREE.BoxGeometry(dims.width, thick, dims.depth);
          geo.translate(0, thick/2, 0); // Bottom edge at origin
          color = 0x8B4513; // Brown for roof
        } else if(isColumn){
          // Columns: Use actual extracted dimensions — no artificial caps
          const colW = dims.width || dims.depth || 0.4;
          const colD = dims.depth || dims.width || 0.4;
          geo = new THREE.BoxGeometry(colW, dims.height, colD);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0x708090; // Steel gray
          materialProps.metalness = 0.6;
        } else if(isBeam){
          // Beams: Use actual extracted dimensions — no artificial caps
          const bH = dims.height || 0.5;
          const bW = dims.width || 0.3;
          geo = new THREE.BoxGeometry(dims.depth || 5, bH, bW);
          geo.translate(0, bH/2, 0); // Bottom edge at origin
          color = 0x708090; // Steel gray
          materialProps.metalness = 0.6;
        } else if(isDoor){
          // Doors: Thin panel with door color
          geo = new THREE.BoxGeometry(dims.width, dims.height, 0.05);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0x8B4513; // Brown for doors
          materialProps.roughness = 0.7;
        } else if(isWindow){
          // Windows: Very thin, glass-like
          geo = new THREE.BoxGeometry(dims.width, dims.height, 0.02);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0x87CEEB; // Sky blue for glass
          materialProps.transparent = true;
          materialProps.opacity = 0.3;
          materialProps.metalness = 0.9;
          materialProps.roughness = 0.1;
        } else if(isStair){
          // Stairs: Multi-step geometry
          geo = new THREE.BoxGeometry(dims.width, dims.height * 0.8, dims.depth);
          geo.translate(0, (dims.height * 0.8)/2, 0); // Bottom edge at origin
          color = 0xCD853F; // Peru/brown for stairs
          materialProps.roughness = 0.8;
        } else if(isElevator){
          // Elevators: Large box with metallic finish
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0x696969; // Dim gray for elevator cars
          materialProps.metalness = 0.7;
          materialProps.roughness = 0.3;
        } else if(isEscalator){
          // Escalators: Angled steps
          geo = new THREE.BoxGeometry(dims.width, dims.height * 0.6, dims.depth);
          geo.translate(0, (dims.height * 0.6)/2, 0); // Bottom edge at origin
          color = 0x778899; // Light slate gray
          materialProps.metalness = 0.6;
        } else if(isRailing){
          // Railings: Thin, tall
          geo = new THREE.BoxGeometry(Math.max(dims.width, 0.1), dims.height, Math.max(dims.depth, 0.05));
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0x708090; // Steel gray
          materialProps.metalness = 0.8;
        } else if(isLight){
          // Lighting fixtures: Small, bright objects
          const size = Math.min(0.5, Math.max(dims.width, dims.height, dims.depth));
          geo = new THREE.SphereGeometry(size * 0.5, 8, 6);
          color = 0xFFD700; // Gold color for lights
          materialProps.emissive = 0x444400; // Bright glow
          materialProps.metalness = 0.3;
        } else if(isReceptacle){
          // Electrical outlets: Small, blue objects
          const size = Math.min(0.2, Math.max(dims.width, dims.height, dims.depth));
          geo = new THREE.BoxGeometry(size, size, size * 0.5);
          geo.translate(0, size/2, 0); // Bottom edge at origin
          color = 0x0066FF; // Bright blue for electrical
          materialProps.metalness = 0.4;
        } else if(isSprinkler){
          // Sprinkler heads: Small, red spheres
          const size = Math.min(0.3, Math.max(dims.width, dims.height, dims.depth));
          geo = new THREE.SphereGeometry(size * 0.4, 6, 4);
          color = 0xFF0000; // Bright red for fire safety
          materialProps.metalness = 0.8;
        } else if(isBathroom){
          // Bathroom fixtures: White ceramic
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0xFFFFF0; // Ivory white for bathroom fixtures
          materialProps.roughness = 0.3;
          materialProps.metalness = 0.1;
        } else if(isCounter){
          // Kitchen counters: Stone/granite appearance
          geo = new THREE.BoxGeometry(dims.width, Math.max(dims.height, 0.1), dims.depth);
          geo.translate(0, Math.max(dims.height, 0.1)/2, 0); // Bottom edge at origin
          color = 0x708090; // Slate gray for countertops
          materialProps.roughness = 0.4;
          materialProps.metalness = 0.1;
        } else if(isKitchen){
          // Kitchen fixtures: Stainless steel look
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0xC0C0C0; // Silver for kitchen appliances
          materialProps.metalness = 0.9;
          materialProps.roughness = 0.2;
        } else if(isHVAC){
          // HVAC: Galvanized steel ductwork
          // v15.30: If routing waypoints exist, create segmented duct run
          const routing = e.properties?.duct_routing || e.properties?.routing;
          if (Array.isArray(routing) && routing.length >= 2) {
            // Build duct run from waypoints as a group of segments
            const ductGroup = new THREE.Group();
            const ductMat = new THREE.MeshStandardMaterial({
              color: e.properties?.system === 'return' ? 0x4682B4 : // steel blue for return
                     e.properties?.system === 'exhaust' ? 0x696969 : // dim gray for exhaust
                     0xA9A9A9, // dark gray for supply
              metalness: 0.7, roughness: 0.4
            });
            for (let ri = 0; ri < routing.length - 1; ri++) {
              const wp1 = routing[ri];
              const wp2 = routing[ri + 1];
              const dx = (wp2.x || 0) - (wp1.x || 0);
              const dy = (wp2.y || 0) - (wp1.y || 0);
              const dz = (wp2.z || 0) - (wp1.z || 0);
              const segLen = Math.sqrt(dx*dx + dy*dy + dz*dz);
              if (segLen < 0.01) continue;
              const segW = dims.width || 0.3;
              const segD = dims.depth || 0.3;
              const segGeo = new THREE.BoxGeometry(segW, segD, segLen);
              const segMesh = new THREE.Mesh(segGeo, ductMat);
              segMesh.position.set(
                ((wp1.x||0) + (wp2.x||0)) / 2,
                ((wp1.z||0) + (wp2.z||0)) / 2, // z→y in viewer
                ((wp1.y||0) + (wp2.y||0)) / 2
              );
              segMesh.lookAt(new THREE.Vector3(wp2.x||0, wp2.z||0, wp2.y||0));
              ductGroup.add(segMesh);
            }
            root.add(ductGroup);
            continue; // skip normal mesh creation for routed ducts
          }
          // Fallback: single box for unrouted ducts
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = e.properties?.system === 'return' ? 0x4682B4 :
                  e.properties?.system === 'exhaust' ? 0x696969 :
                  0xA9A9A9; // Dark gray for supply ducts
          materialProps.metalness = 0.7;
        } else if(isPlumbing){
          // Plumbing: Copper/PVC pipes
          if(dims.width < dims.height || dims.depth < dims.height) {
            // Vertical pipe
            const radius = Math.min(dims.width, dims.depth) / 2;
            geo = new THREE.CylinderGeometry(radius, radius, dims.height, 8);
          } else {
            // Horizontal pipe
            const radius = Math.min(dims.width, dims.height) / 2;
            geo = new THREE.CylinderGeometry(radius, radius, dims.depth, 8);
          }
          color = 0xB87333; // Copper color for plumbing
          materialProps.metalness = 0.8;
        } else if(isElectrical){
          // Electrical: Yellow/orange for safety
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0xFFA500; // Orange for electrical
          materialProps.metalness = 0.3;
        } else if(isMEP){
          // MEP: Pipes/ducts - cylindrical or rectangular
          if(/(pipe|conduit)/.test(type)){
            // Pipes: Cylindrical
            const radius = Math.min(dims.width, dims.depth) / 2;
            const length = Math.max(dims.width, dims.depth, dims.height);
            geo = new THREE.CylinderGeometry(radius, radius, length, 8);
            color = 0xFF6B35; // Orange for pipes
            materialProps.metalness = 0.8;
          } else {
            // Ducts: Rectangular
            geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
            color = 0x36454F; // Charcoal for ducts
            materialProps.metalness = 0.7;
          }
        } else if(isFurniture){
          // Furniture: Wood tones
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0x8B4513; // Saddle brown for furniture
          materialProps.roughness = 0.8;
        } else if(isEquipment){
          // Equipment: Industrial gray
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0x2F4F4F; // Dark slate gray for equipment
          materialProps.metalness = 0.6;
        } else if(isPartition){
          // Interior partitions: Thin, light colored
          geo = new THREE.BoxGeometry(dims.width, dims.height, Math.max(dims.depth, 0.1));
          color = 0xF8F8FF; // Ghost white for partitions
          materialProps.roughness = 0.9;
        } else if(isCeiling){
          // Suspended ceilings: Thin horizontal planes
          geo = new THREE.BoxGeometry(dims.width, Math.max(dims.height, 0.05), dims.depth);
          color = 0xFFFAF0; // Floral white for ceilings
          materialProps.roughness = 0.8;
        } else if(isFlooring){
          // Flooring: Very thin surface layer
          geo = new THREE.BoxGeometry(dims.width, Math.max(dims.height, 0.02), dims.depth);
          color = 0xDEB887; // Burlywood for flooring
          materialProps.roughness = 0.7;
        } else if(isBrick){
          // Brick/masonry: Textured, reddish
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0xB22222; // Fire brick red
          materialProps.roughness = 0.95;
        } else if(isSiding){
          // Siding: Horizontal lines, various colors
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0xF5DEB3; // Wheat color for siding
          materialProps.roughness = 0.8;
        } else if(isCurtainWall){
          // Curtain wall: Mostly glass with metal frame
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0x4682B4; // Steel blue for curtain wall
          materialProps.transparent = true;
          materialProps.opacity = 0.6;
          materialProps.metalness = 0.8;
        } else if(isLandscaping){
          // Landscaping: Green, organic shapes
          geo = new THREE.SphereGeometry(Math.max(dims.width, dims.depth) / 2, 8, 6);
          color = 0x228B22; // Forest green for plants
          materialProps.roughness = 0.9;
        } else if(isDrainage){
          // Drainage: Dark, utilitarian
          geo = new THREE.CylinderGeometry(Math.min(dims.width, dims.depth) / 2, Math.min(dims.width, dims.depth) / 2, dims.height, 6);
          color = 0x2F4F4F; // Dark slate gray for drainage
          materialProps.metalness = 0.3;
        } else if(isPaving){
          // Paving: Flat, gray surfaces
          geo = new THREE.BoxGeometry(dims.width, Math.max(dims.height, 0.15), dims.depth);
          color = 0x708090; // Slate gray for paving
          materialProps.roughness = 0.9;
        } else if(isUtility){
          // Utilities: Bright colors for identification
          geo = new THREE.CylinderGeometry(Math.min(dims.width, dims.depth) / 2, Math.min(dims.width, dims.depth) / 2, dims.height, 8);
          color = 0xFF4500; // Orange red for utilities
          materialProps.metalness = 0.5;
        } else if(isFinish){
          // Generic finishes: Barely visible, decorative
          geo = new THREE.BoxGeometry(dims.width, Math.max(dims.height, 0.01), dims.depth);
          color = 0xF0E68C; // Khaki for finishes
          materialProps.opacity = 0.7;
          materialProps.transparent = true;
        } else {
          // Unknown elements: Bright color for identification
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0xFF1493; // Deep pink for unrecognized elements
        }

        const mat = new THREE.MeshStandardMaterial({ 
          color: color,
          ...materialProps
        });

        // ── RFI / Attention override ──────────────────────────────────────────
        // Elements flagged with rfi_flag or needs_attention are rendered AMBER
        // so the QS immediately sees what needs resolution in the model.
        const isRfiFlagged = !!(e.properties?.rfi_flag || e.properties?.needs_attention);
        if (isRfiFlagged) {
          mat.color.set(0xFFA500);       // Amber
          mat.emissive.set(0x331A00);    // Warm glow
          mat.roughness = 0.6;
          mat.metalness = 0.1;
          mat.transparent = true;
          mat.opacity = 0.82;
        }
        // ─────────────────────────────────────────────────────────────────────
        let mesh = new THREE.Mesh(geo, mat);
        
        // 🏗️ REALISTIC BUILDING POSITIONING: Use actual extracted coordinates from Claude analysis
        if(isWall && e.properties?.start && e.properties?.end) {
          // Walls: coerce start/end to metres + datum offset, then position at midpoint
          const rawStart = e.properties.start;
          const rawEnd = e.properties.end;
          const csStart = coerceWithDatum(Number(rawStart.x||0), Number(rawStart.y||0), 0);
          const csEnd = coerceWithDatum(Number(rawEnd.x||0), Number(rawEnd.y||0), 0);
          const start = { x: csStart.x, y: csStart.y };
          const end = { x: csEnd.x, y: csEnd.y };
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const rotation = getWallRotation(e);

          const wallLength = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          if (!dims || (dims.height <= 0.01 && wallLength <= 0.01)) {
            continue; // Truly empty — skip
          }
          const wallHeight = dims.height;
          const wallThickness = dims.width;
          
          // Create properly sized wall geometry
          const wallGeo = new THREE.BoxGeometry(wallLength, wallHeight, wallThickness);
          mesh = new THREE.Mesh(wallGeo, mat);
          
          // Position at bottom edge (Y-up system)
          mesh.position.set(midX, p.y + wallHeight/2, midY);
          mesh.rotation.y = rotation;
          
          // 🔗 ADD WALL CONNECTION INDICATORS
          const startPoint = new THREE.Vector3(start.x, p.y + dims.height, start.y);
          const endPoint = new THREE.Vector3(end.x, p.y + dims.height, end.y);
          
          // Add small spheres at connection points for debugging
          if(Math.random() < 0.1) { // Only show 10% for performance
            const startSphere = new THREE.Mesh(
              new THREE.SphereGeometry(0.1, 8, 6),
              new THREE.MeshBasicMaterial({color: 0x00FF00})
            );
            startSphere.position.copy(startPoint);
            root.add(startSphere);
            
            const endSphere = new THREE.Mesh(
              new THREE.SphereGeometry(0.1, 8, 6),
              new THREE.MeshBasicMaterial({color: 0xFF0000})
            );
            endSphere.position.copy(endPoint);
            root.add(endSphere);
          }
        } else if(isSlab || isFloor) {
          // Slabs: Bottom edge on floor level
          mesh.position.set(p.x, p.y, p.z);
        } else if(isPlumbing && e.properties?.start && e.properties?.end) {
          // 🔗 CONNECTED PLUMBING: Create continuous pipe runs
          const start = e.properties.start;
          const end = e.properties.end;
          if(start && end) {
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            
            // Recreate geometry for proper pipe run
            const radius = Math.min(dims.width, dims.depth) / 2;
            const pipeGeo = new THREE.CylinderGeometry(radius, radius, length, 8);
            mesh = new THREE.Mesh(pipeGeo, mat);
            geo = pipeGeo;
            mesh.position.set(midX, p.y, midY);
            mesh.rotation.z = Math.PI/2; // Horizontal pipe
            mesh.rotation.y = angle;
          } else {
            mesh.position.set(p.x, p.y, p.z);
          }
        } else {
          // Other elements: Bottom edge positioning
          mesh.position.set(p.x, p.y, p.z);
        }

        // Enhanced edge rendering based on component type
        if(!isWindow) { // Skip edges on transparent windows
          const edges = new THREE.EdgesGeometry(geo);
          const edgeColor = isStruct ? 0x000000 : (isMEP ? 0x333333 : 0x666666);
          const customEdgeMat = new THREE.LineBasicMaterial({ 
            color: edgeColor, 
            opacity: isWall || isSlab ? 0.15 : 0.25, 
            transparent: true 
          });
          mesh.add(new THREE.LineSegments(edges, customEdgeMat));
        }

        mesh.userData = { element:e };
        root.add(mesh);

        // ── Attention beacon for RFI-flagged elements ─────────────────────────
        // A vertical amber ring floats above the element so the QS can spot
        // unresolved items immediately in any view orientation.
        if (isRfiFlagged) {
          const beaconGeo = new THREE.TorusGeometry(0.35, 0.06, 8, 24);
          const beaconMat = new THREE.MeshBasicMaterial({
            color: 0xFF8C00,   // Dark orange — clearly distinct from amber mesh
            transparent: true,
            opacity: 0.95,
          });
          const beacon = new THREE.Mesh(beaconGeo, beaconMat);
          // Place ring 0.4 m above the top of the element
          beacon.position.set(
            mesh.position.x,
            mesh.position.y + (dims.height || 1) + 0.4,
            mesh.position.z,
          );
          beacon.userData = { isAttentionBeacon: true, element: e };
          root.add(beacon);

          // Vertical spike connecting element top to beacon
          const spikeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6);
          const spikeMat = new THREE.MeshBasicMaterial({ color: 0xFF8C00, transparent: true, opacity: 0.7 });
          const spike = new THREE.Mesh(spikeGeo, spikeMat);
          spike.position.set(
            mesh.position.x,
            mesh.position.y + (dims.height || 1) + 0.2,
            mesh.position.z,
          );
          root.add(spike);
        }
        // ─────────────────────────────────────────────────────────────────────

        // 📏 ADD DIMENSION LABELS: Canvas-based text for measurements
        if(Math.random() < 0.3) { // Show dimensions for 30% of elements to avoid clutter
          const dimensionText = createDimensionLabel(dims, type);
          if(dimensionText) {
            dimensionText.position.set(p.x, p.y + dims.height + 0.5, p.z);
            dimensionText.scale.setScalar(Math.max(0.5, Math.min(2, dims.width / 5)));
            root.add(dimensionText);
          }
        }

        // 📐 ADD DISTANCE LINES: For walls, show length measurements
        if(isWall && e.properties?.start && e.properties?.end && Math.random() < 0.2) {
          const start = e.properties.start;
          const end = e.properties.end;
          const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          
          // Create distance line with measurement
          const distanceLine = createDistanceLine(start, end, length);
          if(distanceLine) {
            root.add(distanceLine);
          }
        }

        // expand bbox (using Y-up coordinates: X=left/right, Y=up/down, Z=in/out)
        box.expandByPoint(new THREE.Vector3(p.x - dims.width/2, p.y, p.z - dims.depth/2));
        box.expandByPoint(new THREE.Vector3(p.x + dims.width/2, p.y + dims.height, p.z + dims.depth/2));
      }

      // Log mesh vs box rendering stats
      if (meshRenderedCount > 0 || boxFallbackCount > 0) {
        console.log(`[3D Viewer] Rendered ${meshRenderedCount} elements with real mesh geometry, ${boxFallbackCount} with box fallback`);
      }

      // frame with safety net for tiny scenes
      const size = box.getSize(new THREE.Vector3());
      const diag = Math.max(10, size.length(), 30); // ensure at least ~30m diag for camera
      const center = box.getCenter(new THREE.Vector3());
      buildingCenterRef.current.copy(center);
      buildingSizeRef.current.copy(size);

      // Building should now be properly centered around origin
      console.log(`🎯 Building centered at:`, {
        x: center.x.toFixed(2), 
        y: center.y.toFixed(2), 
        z: center.z.toFixed(2),
        size: {x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2)}
      });
      
      // ── STATIC STRUCTURAL GRID (The Moorings) ──────────────────────────────
      // All 47 gridlines are rendered directly from hardcoded constants — no DB,
      // no parser, no AI.  The floor Y is inferred from the elements in the scene.

      // Remove any previously rendered static gridlines
      const toRemove = three.current?.scene.children.filter(c =>
        typeof c.name === 'string' && c.name.startsWith('sg:')
      ) ?? [];
      toRemove.forEach(c => three.current?.scene.remove(c));

      // Infer floor elevation from elements (fall back to 0 = ground if none present)
      const anyEl = (elements as any[]).find(
        (e: any) => e.geometry?.location?.realLocation?.z !== undefined
      );
      const staticFloorElevRaw = anyEl
        ? Number(anyEl.geometry.location.realLocation.z)
        : 0;
      const staticFloorY = coerceWithDatum(0, 0, staticFloorElevRaw).z;

      // ── Colour scheme (PDF convention):
      //   X-axis lines (letter grid A–Y, running N–S): blue  (#1177CC)
      //   Y-axis lines (number grid 1–19, running E–W): amber (#CC7700)
      //   Wing / angled lines (27.16° and 13.58°):     magenta (#AA00CC)
      const COL_X_HEX   = 0x1177CC;  const COL_X_CSS   = '#1177CC';
      const COL_Y_HEX   = 0xCC7700;  const COL_Y_CSS   = '#CC7700';
      const COL_ANG_HEX = 0xAA00CC;  const COL_ANG_CSS = '#AA00CC';
      const TICK_STEP   = 5;   // metres between dimension ticks
      const TICK_HALF   = 2.0; // half-length of perpendicular tick (metres) — 4m total, visible from plan view

      for (const g of MOORINGS_GRIDLINES) {
        const tanA     = Math.tan(g.angle_deg * (Math.PI / 180));
        const isAngled = Math.abs(g.angle_deg) > 0.01;
        const colHex   = isAngled ? COL_ANG_HEX : (g.axis === 'X' ? COL_X_HEX : COL_Y_HEX);
        const colCss   = isAngled ? COL_ANG_CSS : (g.axis === 'X' ? COL_X_CSS : COL_Y_CSS);

        // ── Endpoints ─────────────────────────────────────────────────────────
        let pt1: THREE.Vector3, pt2: THREE.Vector3;
        if (g.axis === 'X') {
          // NS-running letter lines: sweep parameter is NS (start_m → end_m)
          pt1 = new THREE.Vector3(g.coord + g.start_m * tanA, staticFloorY, g.start_m);
          pt2 = new THREE.Vector3(g.coord + g.end_m   * tanA, staticFloorY, g.end_m);
        } else {
          // EW-running number lines: sweep parameter is EW (start_m → end_m)
          pt1 = new THREE.Vector3(g.start_m, staticFloorY, g.coord);
          pt2 = new THREE.Vector3(g.end_m,   staticFloorY, g.coord - (g.end_m - g.start_m) * tanA);
        }

        // ── Main gridline ──────────────────────────────────────────────────────
        const pts     = new Float32Array([pt1.x, pt1.y, pt1.z, pt2.x, pt2.y, pt2.z]);
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const line    = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: colHex }));
        line.name     = `sg:${g.label}`;
        line.userData = { type: 'grid_line', label: g.label, axis: g.axis, angleDeg: g.angle_deg };
        three.current?.scene.add(line);

        // ── Grid-label bubble at far end ───────────────────────────────────────
        const lc = document.createElement('canvas');
        lc.width = 64; lc.height = 32;
        const ctx2d = lc.getContext('2d')!;
        ctx2d.fillStyle = colCss;
        ctx2d.fillRect(0, 0, 64, 32);
        ctx2d.fillStyle = '#FFFFFF';
        ctx2d.font = 'bold 18px sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillText(g.label, 32, 16);
        const labelTex    = new THREE.CanvasTexture(lc);
        const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthTest: false }));
        labelSprite.scale.set(4, 2, 1);  // 4m × 2m — visible from plan-view distance (~90m)
        const dir = pt2.clone().sub(pt1).normalize();
        labelSprite.position.copy(pt2).addScaledVector(dir, 3).add(new THREE.Vector3(0, 1, 0));
        labelSprite.name = `sg:${g.label}:lbl`;
        three.current?.scene.add(labelSprite);

        // ── Dimension ticks every TICK_STEP metres ─────────────────────────────
        // perp = unit vector perpendicular to the line, horizontal in XZ plane
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);
        const pMin = Math.min(g.start_m, g.end_m);
        const pMax = Math.max(g.start_m, g.end_m);
        const firstTick = Math.ceil(pMin / TICK_STEP) * TICK_STEP;

        for (let param = firstTick; param <= pMax + 0.001; param += TICK_STEP) {
          // 3D position of this tick along the gridline
          let tickPt: THREE.Vector3;
          if (g.axis === 'X') {
            // param = NS coordinate; EW shifts by tanA per metre NS
            tickPt = new THREE.Vector3(g.coord + param * tanA, staticFloorY, param);
          } else {
            // param = EW coordinate; NS shifts by -tanA per metre EW from start_m
            tickPt = new THREE.Vector3(param, staticFloorY, g.coord - (param - g.start_m) * tanA);
          }

          // Tick mark — short line perpendicular to the gridline
          const tA = tickPt.clone().addScaledVector(perp,  TICK_HALF);
          const tB = tickPt.clone().addScaledVector(perp, -TICK_HALF);
          const tickGeo = new THREE.BufferGeometry();
          tickGeo.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([tA.x, tA.y, tA.z, tB.x, tB.y, tB.z]), 3
          ));
          const tick = new THREE.Line(tickGeo,
            new THREE.LineBasicMaterial({ color: colHex, transparent: true, opacity: 0.75 })
          );
          tick.name = `sg:${g.label}:tk:${param}`;
          three.current?.scene.add(tick);

          // Dimension label — the architectural coordinate along this axis
          // X-axis (NS-running): param = PDF-Y (NS from Grid 9); show as "Ym"
          // Y-axis (EW-running): param = PDF-X (EW from Grid A); show as "Xm"
          const dimLabel = createGridLabel(`${param}m`, colCss, 18);
          dimLabel.scale.set(3, 1.5, 1);  // 3m × 1.5m — visible from plan-view distance
          // Place label at the positive-perp side, slightly above floor
          dimLabel.position.copy(tickPt)
            .addScaledVector(perp, TICK_HALF + 2)
            .add(new THREE.Vector3(0, 1, 0));
          dimLabel.name = `sg:${g.label}:dim:${param}`;
          three.current?.scene.add(dimLabel);
        }
      }
      console.log(`[3D Viewer] Rendered ${MOORINGS_GRIDLINES.length} static gridlines at Y=${staticFloorY.toFixed(2)}`);

      // ── GRID INTERSECTION MARKERS ──────────────────────────────────────
      // Compute and render a small sphere at each valid grid intersection.
      // Only where gridlines physically cross (extents overlap).
      const alphaLines = MOORINGS_GRIDLINES.filter(g => g.axis === 'X');
      const numericLines = MOORINGS_GRIDLINES.filter(g => g.axis === 'Y');
      let intersectionCount = 0;

      for (const alpha of alphaLines) {
        for (const numeric of numericLines) {
          // Extent overlap check
          const tol = 5;
          const aMin = Math.min(alpha.start_m, alpha.end_m) - tol;
          const aMax = Math.max(alpha.start_m, alpha.end_m) + tol;
          const nMin = Math.min(numeric.start_m, numeric.end_m) - tol;
          const nMax = Math.max(numeric.start_m, numeric.end_m) + tol;
          if (alpha.coord < nMin || alpha.coord > nMax) continue;
          if (numeric.coord < aMin || numeric.coord > aMax) continue;

          // Compute intersection
          const tanA = Math.tan(alpha.angle_deg * (Math.PI / 180));
          const tanN = Math.tan(numeric.angle_deg * (Math.PI / 180));
          const denom = 1 + tanA * tanN;
          if (Math.abs(denom) < 1e-10) continue;
          const ns = (numeric.coord + (numeric.start_m - alpha.coord) * tanN) / denom;
          const ew = alpha.coord + ns * tanA;

          // Verify intersection is within extents
          if (ew < nMin || ew > nMax || ns < aMin || ns > aMax) continue;

          // Render intersection marker — small sphere
          const markerGeo = new THREE.SphereGeometry(0.3, 8, 6);
          const isAngled = Math.abs(alpha.angle_deg) > 0.01 || Math.abs(numeric.angle_deg) > 0.01;
          const markerColor = isAngled ? 0xFF00FF : 0x00FF00;
          const markerMat = new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.7 });
          const marker = new THREE.Mesh(markerGeo, markerMat);
          marker.position.set(ew, staticFloorY + 0.1, ns);
          marker.name = `sg:int:${alpha.label}-${numeric.label}`;
          marker.userData = {
            type: 'grid_intersection',
            label: `${alpha.label}-${numeric.label}`,
            ew: Math.round(ew * 1000) / 1000,
            ns: Math.round(ns * 1000) / 1000,
            z: staticFloorY,
          };
          three.current?.scene.add(marker);

          // Label at intersection — small text showing "A-9" etc.
          const intCanvas = document.createElement('canvas');
          intCanvas.width = 96; intCanvas.height = 24;
          const intCtx = intCanvas.getContext('2d')!;
          intCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          intCtx.fillRect(0, 0, 96, 24);
          intCtx.fillStyle = '#FFFFFF';
          intCtx.font = '12px monospace';
          intCtx.textAlign = 'center';
          intCtx.textBaseline = 'middle';
          intCtx.fillText(`${alpha.label}-${numeric.label}`, 48, 12);
          const intTex = new THREE.CanvasTexture(intCanvas);
          const intSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: intTex, depthTest: false }));
          intSprite.scale.set(1.2, 0.3, 1);
          intSprite.position.set(ew, staticFloorY + 0.5, ns);
          intSprite.name = `sg:int:${alpha.label}-${numeric.label}:lbl`;
          three.current?.scene.add(intSprite);

          intersectionCount++;
        }
      }
      console.log(`[3D Viewer] Rendered ${intersectionCount} grid intersection markers`);

      // Axes are pinned to world origin = Grid A-9 = Three.js (0, 0, 0).
      // DO NOT move axes to building center — it breaks the A-9 origin reference.
      const axes = three.current?.scene.getObjectByName("axes") as THREE.AxesHelper;
      if (axes) {
        axes.visible = true;
        axes.position.set(0, 0, 0); // World origin = Grid A-9 intersection
        const axisScale = Math.max(2, Math.min(20, diag / 15));
        (axes as any).scale.setScalar(axisScale);

        // Remove previous axis labels
        const oldLabels = three.current?.scene.children.filter(c =>
          c.name === 'axisLabelX' || c.name === 'axisLabelY' || c.name === 'axisLabelZ'
        );
        oldLabels?.forEach(l => three.current?.scene.remove(l));

        // Axis labels use PDF drawing convention (A101):
        //   X  = East-West      (positive → east)       Three.js X
        //   Y  = North-South    (positive → north)      Three.js Z  ← swapped!
        //   Z  = Elevation      (positive → up)         Three.js Y  ← swapped!
        // The Three.js engine uses Y-up internally, but all labels and user-facing
        // coordinates are expressed in PDF convention so they match the drawings.
        const xLabel = createGridLabel('X+ (East)', '#FF3333', 22);
        xLabel.name = 'axisLabelX';
        xLabel.position.set(axisScale * 1.3, 0.2, 0);
        xLabel.scale.setScalar(axisScale * 0.4);
        three.current?.scene.add(xLabel);

        // Three.js Y = PDF Z (elevation/up)
        const yLabel = createGridLabel('Z+ (Elevation)', '#33CC33', 22);
        yLabel.name = 'axisLabelY';
        yLabel.position.set(0.3, axisScale * 1.2, 0);
        yLabel.scale.setScalar(axisScale * 0.4);
        three.current?.scene.add(yLabel);

        // Three.js Z = PDF Y (north-south, positive = north toward Grid 1)
        const zLabel = createGridLabel('Y+ (North)', '#3333FF', 22);
        zLabel.name = 'axisLabelZ';
        zLabel.position.set(0, 0.2, axisScale * 1.3);
        zLabel.scale.setScalar(axisScale * 0.4);
        three.current?.scene.add(zLabel);
      }
      
      // 🎯 BUILDING FOOTPRINT DEBUG
      console.log(`🏗️ Building Analysis:`, {
        center: {x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2)},
        size: {x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2)},
        wallCount: elements.filter((e: any) => e.elementType === 'WALL').length,
        elementTypes: Array.from(new Set(elements.map((e: any) => e.elementType)))
      });

      controls.target.copy(center);
      // 🎯 IMPROVED CAMERA POSITIONING: Better view for building scale
      const cameraDistance = Math.max(diag * 0.8, 50); // Minimum 50m distance
      const cameraOffset = new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(cameraDistance);
      camera.position.copy(center).add(cameraOffset);
      
      // Ensure camera can see the full building
      camera.near = Math.max(0.1, cameraDistance / 100);
      camera.far = Math.max(5000, cameraDistance * 20);
      camera.updateProjectionMatrix();
      
      console.log(`🎯 Camera positioned at:`, {
        position: {x: camera.position.x.toFixed(1), y: camera.position.y.toFixed(1), z: camera.position.z.toFixed(1)},
        target: {x: center.x.toFixed(1), y: center.y.toFixed(1), z: center.z.toFixed(1)},
        distance: cameraDistance.toFixed(1)
      });
      setIsLoading(false);
    })().catch(err => {
      console.error('BIM load error:', err);
      setIsLoading(false);
    });
    
    return () => {
      if(loadAbortController.current) {
        loadAbortController.current.abort();
      }
      setIsLoading(false); // Reset so re-runs aren't blocked by stale isLoading=true
    };
  },[ready, modelId, visibleStoreys]); // re-render on floor toggle

  return (
    <Card className="w-full h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>BIM Viewer</CardTitle>
          <div className="flex items-center gap-3">
            {loaded && attentionCount > 0 && (
              <div className="flex items-center gap-1.5 bg-orange-100 border border-orange-400 text-orange-800 text-xs font-semibold px-2.5 py-1 rounded-full">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
                {attentionCount} RFI{attentionCount > 1 ? 's' : ''} need attention
              </div>
            )}
            {storeys.length > 0 && (
              <Button
                size="sm"
                variant={showFloorPanel ? "default" : "outline"}
                className="flex items-center gap-1.5 text-xs"
                onClick={()=>setShowFloorPanel(v=>!v)}
              >
                <Layers className="h-3.5 w-3.5"/>
                Floors ({storeys.length})
              </Button>
            )}
            {loaded && elementCount > 0 && (
              <div className="text-sm text-green-600 font-medium">
                ✅ {elementCount.toLocaleString()} elements loaded
              </div>
            )}
          </div>
        </div>

        {/* ── Per-floor visibility panel ───────────────────────────────────── */}
        {showFloorPanel && storeys.length > 0 && (
          <div className="mt-2 border rounded-lg bg-white shadow-md p-3 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Floor Visibility</span>
              <div className="flex gap-2">
                <button
                  className="text-xs text-blue-600 hover:underline"
                  onClick={()=>setVisibleStoreys(new Set(storeys.map(s=>s.name)))}
                >Show all</button>
                <span className="text-slate-300">|</span>
                <button
                  className="text-xs text-slate-500 hover:underline"
                  onClick={()=>setVisibleStoreys(new Set())}
                >Hide all</button>
              </div>
            </div>
            <div className="space-y-1">
              {[...storeys].sort((a,b)=>b.elevation-a.elevation).map(storey=>{
                const visible = visibleStoreys.has(storey.name);
                return (
                  <div
                    key={storey.id}
                    className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      visible ? 'bg-blue-50 hover:bg-blue-100' : 'bg-slate-50 hover:bg-slate-100 opacity-60'
                    }`}
                    onClick={()=>{
                      setVisibleStoreys(prev=>{
                        const next = new Set(prev);
                        if(next.has(storey.name)) next.delete(storey.name);
                        else next.add(storey.name);
                        return next;
                      });
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {visible
                        ? <Eye className="h-3.5 w-3.5 text-blue-500 flex-shrink-0"/>
                        : <EyeOff className="h-3.5 w-3.5 text-slate-400 flex-shrink-0"/>
                      }
                      <span className="text-xs font-medium text-slate-700 truncate">{storey.name}</span>
                      {storey.rfiFlag && (
                        <AlertTriangle className="h-3 w-3 text-orange-500 flex-shrink-0" aria-label="Elevation estimated — RFI open"/>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-xs text-slate-400">{storey.elevation >= 0 ? '+' : ''}{Number(storey.elevation).toFixed(3)} m</span>
                      <span className="text-xs text-slate-400">{storey.elementCount} elem</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {storeys.some(s=>s.rfiFlag) && (
              <p className="mt-2 text-xs text-orange-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3"/> Floors marked with ⚠ have estimated elevations — see RFI dashboard
              </p>
            )}
          </div>
        )}
        {/* ───────────────────────────────────────────────────────────────── */}

        <div className="md:hidden bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-800 mt-2">
          📱 <strong>Touch Controls:</strong> 1 finger = rotate view, 2 fingers = zoom &amp; pan
        </div>
      </CardHeader>
      <CardContent className="p-0 relative h-[70vh]">
        <div 
          ref={mountRef} 
          className="w-full h-full"
          style={{
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none' as any
          }}
        />

        {/* ── Coordinate system + gridline colour legend ───────────────────── */}
        <div className="absolute bottom-14 right-3 bg-black/75 text-white text-[10px] leading-relaxed rounded px-2.5 py-2 font-mono pointer-events-none select-none">
          <div className="font-semibold text-[10px] text-slate-300 mb-1 uppercase tracking-wide">Coordinates (PDF A101)</div>
          <div><span className="text-red-400 font-bold">■</span> X = E–W &nbsp;(+ east)</div>
          <div><span className="text-blue-400 font-bold">■</span> Y = N–S &nbsp;(+ north)</div>
          <div><span className="text-green-400 font-bold">■</span> Z = Elev (+ up)</div>
          <div className="mt-1 text-slate-400 text-[9px]">Origin: Grid A-9 = (0, 0, 0)</div>
          <div className="mt-1.5 border-t border-slate-600 pt-1 font-semibold text-[10px] text-slate-300 uppercase tracking-wide">Gridlines</div>
          <div><span style={{color:'#4499EE'}} className="font-bold">■</span> A–Y &nbsp;letter grid (N–S)</div>
          <div><span style={{color:'#EE9922'}} className="font-bold">■</span> 1–19 number grid (E–W)</div>
          <div><span style={{color:'#CC44EE'}} className="font-bold">■</span> Wing / angled (27.16°)</div>
          <div className="text-slate-400 text-[9px] mt-0.5">Ticks every 5 m</div>
        </div>

        {/* ✅ Mobile-friendly large touch controls for iPhone */}
        <div className="absolute left-3 bottom-3 flex gap-2">
          <Button 
            size="lg" 
            variant="outline" 
            className="md:size-8 lg:size-10 bg-white/90 hover:bg-white shadow-lg touch-manipulation"
            onClick={()=>three.current?.camera.position.multiplyScalar(0.85)}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-5 w-5"/>
          </Button>
          <Button 
            size="lg" 
            variant="outline" 
            className="md:size-8 lg:size-10 bg-white/90 hover:bg-white shadow-lg touch-manipulation"
            onClick={()=>three.current?.camera.position.multiplyScalar(1.15)}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-5 w-5"/>
          </Button>
          <Button 
            size="lg" 
            variant="outline" 
            className="md:size-8 lg:size-10 bg-white/90 hover:bg-white shadow-lg touch-manipulation"
            onClick={()=>{
              if(!three.current) return; 
              const {camera,controls} = three.current;
              const grid = three.current.scene.getObjectByName("grid") as THREE.GridHelper;
              const _size = 40; const center = new THREE.Vector3(0,0,0);
              if(grid){ grid.position.set(0,0,0); }
              controls.target.copy(center); 
              camera.position.set(10,8,10); 
              camera.updateProjectionMatrix();
            }}
            data-testid="button-reset-view"
          >
            <Home className="h-5 w-5"/>
          </Button>

          {/* Plan View — top-down, north (PDF Y+) pointing up, matching drawing orientation */}
          <Button
            size="lg"
            variant="outline"
            className="md:size-8 lg:size-10 bg-blue-50/90 hover:bg-blue-100 shadow-lg touch-manipulation border-blue-300"
            title="Plan View — top-down, north up (matches PDF drawing)"
            onClick={()=>{
              if(!three.current) return;
              const {camera, controls} = three.current;
              const c = buildingCenterRef.current;
              const s = buildingSizeRef.current;
              // Height: enough to see the full building footprint with some margin
              const height = Math.max(s.x, s.z) * 0.9 + 20;
              // Target: building centroid at floor level
              controls.target.set(c.x, c.y, c.z);
              // Camera nearly overhead — tiny Z offset avoids the pole/gimbal-lock
              // singularity that happens at exactly θ=π (straight down).
              // With camera.up=(0,0,1), north (Three.js Z+) points "up" on screen,
              // east (Three.js X+) points right — matches the PDF plan orientation.
              camera.up.set(0, 0, 1);
              camera.position.set(c.x, c.y + height, c.z + 0.001);
              controls.update();
              camera.updateProjectionMatrix();
            }}
            data-testid="button-plan-view"
          >
            <MapIcon className="h-5 w-5 text-blue-600"/>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}