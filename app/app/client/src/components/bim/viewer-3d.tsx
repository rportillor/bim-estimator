import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
// @ts-ignore - Three.js types issue with package exports
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ZoomIn, ZoomOut, Home, Layers, Eye, EyeOff, AlertTriangle } from "lucide-react";

// ---- Exports kept for ModelProperties ----
export const UNIT_SYSTEMS = { METRIC: 'metric', IMPERIAL: 'imperial' } as const;
export type UnitSystem = typeof UNIT_SYSTEMS[keyof typeof UNIT_SYSTEMS];

export interface ViewerProps {
  ifcUrl?: string;
  modelId?: string;
  onElementSelect?: (e: SelectedElement|null) => void;
  unitSystem?: UnitSystem;
  showBothUnits?: boolean;
}

export interface SelectedElement {
  expressID?: number;
  type: string;
  material?: string;
  dimensions?: { height?: number; width?: number; length?: number };
  volume?: number;
  area?: number;
  properties?: Record<string, any>;
}

// simple metric-only for now (keeps API)
export const unitConversion = {
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
    // For walls: calculate length from start/end points (in millimeters), use properties for thickness/height
    const start = e.properties.start;
    const end = e.properties.end;
    const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    // Convert from millimeters to meters for Three.js display
    // Only use actual values from Claude's analysis, no defaults
    const actualLength = length || geom.width;
    const actualHeight = props.height || geom.height;
    const actualDepth = props.width || geom.depth || geom.width;  // v15.8 BUG2: geom.width is where createWallElement stores thickness
    
    if (!actualLength || !actualHeight || !actualDepth) {
      return null; // Don't render if dimensions are missing
    }
    
    // BUG FIX (v15.4): coordinates and dimensions are already in METRES.
    // real-qto-processor converts mm->m before storing. Do NOT divide by 1000.
    return {
      width:  Math.max(0.001, Math.min(500, actualLength  || 1)),
      height: Math.max(0.001, Math.min(50,  actualHeight  || 3)),
      depth:  Math.max(0.001, Math.min(5,   actualDepth   || 0.2)),
    };
  }
  
  // For other elements: dimensions are already in metres from real-qto-processor.
  // NO DEFAULTS - only use actual values from Claude's analysis
  let width  = Number(geom.width ?? props.width ?? geom.x);
  let height = Number(geom.height ?? props.height ?? geom.y);
  let depth  = Number(geom.depth ?? props.depth ?? geom.z ?? geom.length);
  
  // If any dimension is missing or invalid, don't render
  if (!width || !height || !depth || !isFinite(width) || !isFinite(height) || !isFinite(depth)) {
    return null;
  }
  
  // Coerce to metres (backward compat with pre-v15.4 mm dimensions)
  return {
    width:  Math.max(0.001, Math.min(500, coerceDimToMetres(width))),
    height: Math.max(0.001, Math.min(50,  coerceDimToMetres(height))),
    depth:  Math.max(0.001, Math.min(500, coerceDimToMetres(depth))),
  };
}

function getRealLocation(e:any){
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
    } catch(err) {
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
      } catch(err) {
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
    new THREE.Vector3(start.x, start.y + 2, start.y), // Elevated for visibility
    new THREE.Vector3(end.x, end.y + 2, end.y)
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

function getWallRotation(e:any) {
  // 🏗️ Calculate wall rotation from start/end points
  if(!e.properties?.start || !e.properties?.end) return 0;
  
  const start = e.properties.start;
  const end = e.properties.end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  return Math.atan2(dy, dx); // Rotation in radians
}

export default function Viewer3D({ modelId }: ViewerProps){
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
  // ─────────────────────────────────────────────────────────────────────────
  const loadAbortController = useRef<AbortController|null>(null);

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
    
    // Force touch event handling for iOS
    const canvas = renderer.domElement;
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    
    // Add manual gesture handling for iOS compatibility
    let lastTouchDistance = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: false });
    
    canvas.addEventListener('touchmove', (e) => {
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
    setReady(true);
    return ()=>{ cancelAnimationFrame(id); ro.disconnect(); renderer.dispose(); while(scene.children.length) scene.remove(scene.children[0]); container.removeChild(renderer.domElement); three.current=null; setReady(false); };
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
    
    // Cancel any previous load
    if(loadAbortController.current) {
      loadAbortController.current.abort();
    }
    loadAbortController.current = new AbortController();
    
    const {scene,camera,controls} = three.current;
    // clear previous (keep helpers)
    for(let i=scene.children.length-1;i>=0;i--){
      const c = scene.children[i]; if(!(c instanceof THREE.GridHelper) && !(c instanceof THREE.AxesHelper)) scene.remove(c);
    }
    const root = new THREE.Group(); scene.add(root);

    (async ()=>{
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
      const mepConnections = new Map();
      
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
      
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.25, transparent: true });
      const box = new THREE.Box3();

      // 🎯 COORDINATE TRANSFORMATION: Properly transform building coordinates to Three.js coordinate system
      // Building data: X=X, Y=depth, Z=height (vertical)
      // Three.js: X=X, Y=height (vertical), Z=depth
      let minZ = Infinity, maxZ = -Infinity;
      let minBuildingY = Infinity, maxBuildingY = -Infinity;
      const rawCoords = elements.map((e: any) => {
        // Parse location if it's a JSON string
        let parsedLocation = null;
        if (typeof e?.location === 'string' && e.location !== '{}') {
          try {
            parsedLocation = JSON.parse(e.location);
          } catch(err) {
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
      
      // Calculate Y offset to bring building to ground level (Y=0 in Three.js)
      // Fix: Don't apply large offsets that push building way off screen
      const yOffset = 0; // Keep building centered - no large coordinate offset
      console.log(`🎯 Coordinate system transformation: Y offset = ${yOffset.toFixed(1)}m (Building: Y=${minBuildingY.toFixed(1)} to ${maxBuildingY.toFixed(1)}, Z=${minZ.toFixed(1)} to ${maxZ.toFixed(1)})`);

      for(const e of elements){
        const dims = getDims(e);
        if (!dims) continue; // TS18047 fix: getDims returns null when dimensions missing — skip element

        // Get raw location and parse if needed
        let parsedLocation = null;
        if (typeof e?.location === 'string' && e.location !== '{}') {
          try {
            parsedLocation = JSON.parse(e.location);
          } catch(err) {
            // Ignore parse errors
          }
        }
        
        const rawLocation = e?.geometry?.location?.realLocation
              || e?.properties?.realLocation
              || e?.geometry?.location?.coordinates
              || parsedLocation
              || e?.location
              || {x:0,y:0,z:0};
        
        // Coerce to metres (backward compat), then axis-swap for Three.js
        const cc2 = coerceCoordToMetres(
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
        const isOpening = isDoor || isWindow || /(opening|aperture)/.test(type);
        
        // Vertical Transportation & Circulation
        const isStair = /(stair|step|riser|tread|flight)/.test(type);
        const isRailing = /(railing|handrail|guardrail|balustrade)/.test(type);
        const isElevator = /(elevator|lift)/.test(type);
        const isEscalator = /(escalator|moving.walk)/.test(type);
        const isVerticalTransport = isElevator || isEscalator;
        
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
        const isFixture = isBathroom || isKitchen || /(fixture|appliance)/.test(type);
        
        // Furniture & Equipment
        const isFurniture = /(furniture|desk|chair|table|bed|sofa|shelf)/.test(type);
        const isEquipment = /(equipment|machine|motor|pump|unit)/.test(type);
        
        // Site Work & Exterior
        const isLandscaping = /(landscape|plant|tree|shrub|grass|garden)/.test(type);
        const isDrainage = /(drainage|drain|gutter|downspout|catch.basin)/.test(type);
        const isPaving = /(paving|asphalt|concrete.slab|sidewalk|driveway|parking)/.test(type);
        const isUtility = /(utility|gas|water.main|sewer.main|electrical.service)/.test(type);
        const isSiteWork = isLandscaping || isDrainage || isPaving || isUtility;
        
        // Interior Components & Finishes
        const isPartition = /(partition|drywall|gypsum|glass.partition)/.test(type);
        const isCeiling = /(ceiling|suspended|drop|acoustic)/.test(type);
        const isFlooring = /(flooring|tile|carpet|hardwood|vinyl|laminate)/.test(type);
        const isPaint = /(paint|coating|finish)/.test(type);
        const isMillwork = /(millwork|trim|molding|baseboard|crown)/.test(type);
        const isFinish = isFlooring || isPaint || isMillwork || /(finish)/.test(type);
        const isInsulation = /(insulation|thermal|vapor|barrier)/.test(type);
        
        // Exterior Wall Materials
        const isBrick = /(brick|masonry|stone|granite|limestone)/.test(type);
        const isSiding = /(siding|cladding|vinyl|aluminum|wood.siding)/.test(type);
        const isCurtainWall = /(curtain.wall|glass.wall|storefront)/.test(type);
        const isExteriorFinish = isBrick || isSiding || isCurtainWall;
        
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
          // Columns: Vertical, square cross-section
          const size = Math.min(dims.width, dims.depth, 0.6); // Max 60cm square
          geo = new THREE.BoxGeometry(size, dims.height, size);
          geo.translate(0, dims.height/2, 0); // Bottom edge at origin
          color = 0x708090; // Steel gray
          materialProps.metalness = 0.6;
        } else if(isBeam){
          // Beams: Horizontal, rectangular
          const height = Math.min(dims.height, 0.8); // Typical beam height
          const width = Math.min(dims.width, 0.4);   // Typical beam width
          geo = new THREE.BoxGeometry(dims.depth, height, width);
          geo.translate(0, height/2, 0); // Bottom edge at origin
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
          // HVAC: Galvanized steel appearance
          geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
          color = 0xA9A9A9; // Dark gray for HVAC
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
          // Walls: Position at midpoint and rotate to align with start/end
          const start = e.properties.start;
          const end = e.properties.end;
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const rotation = getWallRotation(e);
          
          // Use actual wall dimensions from Claude analysis
          const wallLength = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          // Only use actual dimensions from Claude's analysis
          if (!dims || !dims.height || !dims.width) {
            console.warn('Missing wall dimensions, skipping visualization');
            continue;
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
            geo = new THREE.CylinderGeometry(radius, radius, length, 8);
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

      // frame with safety net for tiny scenes
      const size = box.getSize(new THREE.Vector3());
      const diag = Math.max(10, size.length(), 30); // ensure at least ~30m diag for camera
      const center = box.getCenter(new THREE.Vector3());
      
      // Building should now be properly centered around origin
      console.log(`🎯 Building centered at:`, {
        x: center.x.toFixed(2), 
        y: center.y.toFixed(2), 
        z: center.z.toFixed(2),
        size: {x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2)}
      });
      
      // 🏗️ CREATE ANALYSIS-BASED CONSTRUCTION GRIDS
      // Remove old grids
      const oldGrids = three.current?.scene.children.filter(child => 
        child.name?.includes("grid") || child.name?.includes("Grid")
      );
      oldGrids?.forEach(grid => three.current?.scene.remove(grid));
      
      // Create actual construction grid lines from analysis
      if(gridAnalysis.xs.length > 0 && gridAnalysis.ys.length > 0) {
        const gridMaterial = new THREE.LineBasicMaterial({ color: 0x444444, opacity: 0.6, transparent: true });
        const gridPoints: THREE.Vector3[] = [];
        
        // Create X-direction grid lines (vertical lines)
        const minZ = Math.min(...gridAnalysis.ys) - 5;
        const maxZ = Math.max(...gridAnalysis.ys) + 5;
        for(const x of gridAnalysis.xs) {
          gridPoints.push(new THREE.Vector3(x, 0, minZ));
          gridPoints.push(new THREE.Vector3(x, 0, maxZ));
        }
        
        // Create Y-direction grid lines (horizontal lines)  
        const minX = Math.min(...gridAnalysis.xs) - 5;
        const maxX = Math.max(...gridAnalysis.xs) + 5;
        for(const z of gridAnalysis.ys) {
          gridPoints.push(new THREE.Vector3(minX, 0, z));
          gridPoints.push(new THREE.Vector3(maxX, 0, z));
        }
        
        const gridGeometry = new THREE.BufferGeometry().setFromPoints(gridPoints);
        const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial);
        gridLines.name = "analysisGrid";
        three.current?.scene.add(gridLines);
        
        console.log(`🏗️ Created ${gridAnalysis.xs.length} × ${gridAnalysis.ys.length} construction grid from analysis`);
      }
      
      // Update axes positioning - place at ground level (Y=0)
      const axes = three.current?.scene.getObjectByName("axes") as THREE.AxesHelper;
      if (axes) { 
        axes.visible = true; 
        axes.position.set(center.x, 0, center.z); // Y=0 for ground level
        (axes as any).scale.setScalar(Math.max(2, Math.min(20, diag / 15))); 
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
    };
  },[ready, modelId, visibleStoreys]); // visibleStoreys: re-render scene on floor toggle

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
              const size = 40; const center = new THREE.Vector3(0,0,0);
              if(grid){ grid.position.set(0,0,0); }
              controls.target.copy(center); 
              camera.position.set(10,8,10); 
              camera.updateProjectionMatrix();
            }}
            data-testid="button-reset-view"
          >
            <Home className="h-5 w-5"/>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}