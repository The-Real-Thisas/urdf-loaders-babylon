import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, ShadowGenerator, MeshBuilder, StandardMaterial, Color3, Color4, Vector3, Quaternion, Mesh, Material, TransformNode } from '@babylonjs/core';
import URDFLoader from './URDFLoader.js';

// urdf-viewer element
// Loads and displays a 3D view of a URDF-formatted robot

// Events
// urdf-change: Fires when the URDF has finished loading and getting processed
// urdf-processed: Fires when the URDF has finished loading and getting processed
// geometry-loaded: Fires when all the geometry has been fully loaded
// ignore-limits-change: Fires when the 'ignore-limits' attribute changes
// angle-change: Fires when an angle changes
export default
class URDFViewer extends HTMLElement {

    static get observedAttributes() {

        return ['package', 'urdf', 'up', 'display-shadow', 'ambient-color', 'ignore-limits', 'show-collision'];

    }

    get package() { return this.getAttribute('package') || ''; }
    set package(val) { this.setAttribute('package', val); }

    get urdf() { return this.getAttribute('urdf') || ''; }
    set urdf(val) { this.setAttribute('urdf', val); }

    get ignoreLimits() { return this.hasAttribute('ignore-limits') || false; }
    set ignoreLimits(val) { val ? this.setAttribute('ignore-limits', val) : this.removeAttribute('ignore-limits'); }

    get up() { return this.getAttribute('up') || '+Z'; }
    set up(val) { this.setAttribute('up', val); }

    get displayShadow() { return this.hasAttribute('display-shadow') || false; }
    set displayShadow(val) { val ? this.setAttribute('display-shadow', '') : this.removeAttribute('display-shadow'); }

    get ambientColor() { return this.getAttribute('ambient-color') || '#8ea0a8'; }
    set ambientColor(val) { val ? this.setAttribute('ambient-color', val) : this.removeAttribute('ambient-color'); }

    get autoRedraw() { return this.hasAttribute('auto-redraw') || false; }
    set autoRedraw(val) { val ? this.setAttribute('auto-redraw', true) : this.removeAttribute('auto-redraw'); }

    get noAutoRecenter() { return this.hasAttribute('no-auto-recenter') || false; }
    set noAutoRecenter(val) { val ? this.setAttribute('no-auto-recenter', true) : this.removeAttribute('no-auto-recenter'); }

    get showCollision() { return this.hasAttribute('show-collision') || false; }
    set showCollision(val) { val ? this.setAttribute('show-collision', true) : this.removeAttribute('show-collision'); }

    get jointValues() {

        const values = {};
        if (this.robot) {

            for (const name in this.robot.joints) {

                const joint = this.robot.joints[name];
                values[name] = joint.jointValue.length === 1 ? joint.angle : [...joint.jointValue];

            }

        }

        return values;

    }
    set jointValues(val) { this.setJointValues(val); }

    get angles() {

        return this.jointValues;

    }
    set angles(v) {

        this.jointValues = v;

    }

    /* Lifecycle Functions */
    constructor() {

        super();

        this._requestId = 0;
        this._dirty = false;
        this._loadScheduled = false;
        this.robot = null;
        this.loadMeshFunc = null;
        this.urlModifierFunc = null;

        // Create a canvas element for Babylon.js
        const canvas = document.createElement('canvas');
        this._canvas = canvas;

        // Engine setup
        const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        this.engine = engine;

        // Scene setup
        const scene = new Scene(engine);
        scene.useRightHandedSystem = true;
        scene.clearColor = new Color4(0, 0, 0, 0);

        // Ambient light
        const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
        const c3 = this._parseColor(this.ambientColor);
        ambientLight.diffuse = c3;
        ambientLight.groundColor = Color3.Lerp(Color3.Black(), c3, 0.5);
        ambientLight.intensity = 0.5;

        // Directional light
        const dirLight = new DirectionalLight('dirLight', new Vector3(-4, -10, -1), scene);
        dirLight.intensity = Math.PI;
        dirLight.position = new Vector3(4, 10, 1);

        // Shadow generator
        this._shadowGenerator = new ShadowGenerator(2048, dirLight);
        this._shadowGenerator.useBlurExponentialShadowMap = true;
        this._shadowGenerator.bias = 0.001;

        // Camera setup (ArcRotateCamera has built-in orbit controls)
        const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 10, Vector3.Zero(), scene);
        camera.minZ = 0.1;
        camera.maxZ = 1000;
        camera.lowerRadiusLimit = 0.25;
        camera.upperRadiusLimit = 50;
        camera.wheelPrecision = 5;
        camera.panningSensibility = 50;
        camera.attachControl(canvas, true);

        // World node for up-axis rotation
        const world = new TransformNode('world', scene);
        world.rotationQuaternion = new Quaternion();

        // Ground plane for shadows
        const ground = MeshBuilder.CreateGround('ground', { width: 400, height: 400 }, scene);
        const groundMaterial = new StandardMaterial('groundMat', scene);
        groundMaterial.diffuseColor = Color3.Black();
        groundMaterial.specularColor = Color3.Black();
        groundMaterial.alpha = 0.25;
        ground.material = groundMaterial;
        ground.receiveShadows = true;
        ground.position.y = -0.5;
        ground.isPickable = false;

        this.scene = scene;
        this.babylonScene = scene;
        this.world = world;
        this.camera = camera;
        this.controls = camera; // camera is also the controls in Babylon.js
        this.ground = ground;
        this.directionalLight = dirLight;
        this.ambientLight = ambientLight;

        this._setUp(this.up);

        this._collisionMaterial = new StandardMaterial('collisionMat', scene);
        this._collisionMaterial.diffuseColor = new Color3(1.0, 0.745, 0.22);
        this._collisionMaterial.alpha = 0.35;
        this._collisionMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;

        // Render loop
        engine.runRenderLoop(() => {

            if (this.parentNode) {

                this.updateSize();

                if (this._dirty || this.autoRedraw) {

                    if (!this.noAutoRecenter) {

                        this._updateEnvironment();
                    }

                    this._dirty = false;

                }

                scene.render();

            }

        });

    }

    _parseColor(colorStr) {

        if (!colorStr) return new Color3(0.56, 0.63, 0.66);
        try {

            // Expand shorthand hex
            if (colorStr.length === 4) {

                colorStr = '#' + colorStr[1] + colorStr[1] + colorStr[2] + colorStr[2] + colorStr[3] + colorStr[3];

            }
            return Color3.FromHexString(colorStr);

        } catch {

            return new Color3(0.56, 0.63, 0.66);

        }

    }

    connectedCallback() {

        // Add our initialize styles for the element if they haven't
        // been added yet
        if (!this.constructor._styletag) {

            const styletag = document.createElement('style');
            styletag.innerHTML =
            `
                ${ this.tagName } { display: block; }
                ${ this.tagName } canvas {
                    width: 100%;
                    height: 100%;
                }
            `;
            document.head.appendChild(styletag);
            this.constructor._styletag = styletag;

        }

        // add the canvas
        if (this.childElementCount === 0) {

            this.appendChild(this._canvas);

        }

        this.updateSize();
        requestAnimationFrame(() => this.updateSize());

    }

    disconnectedCallback() {

        this.engine.stopRenderLoop();

    }

    attributeChangedCallback(attr, oldval, newval) {

        this._updateCollisionVisibility();
        if (!this.noAutoRecenter) {
            this.recenter();
        }

        switch (attr) {

            case 'package':
            case 'urdf': {

                this._scheduleLoad();
                break;

            }

            case 'up': {

                this._setUp(this.up);
                break;

            }

            case 'ambient-color': {

                const c3 = this._parseColor(this.ambientColor);
                this.ambientLight.diffuse = c3;
                this.ambientLight.groundColor = Color3.Lerp(Color3.Black(), c3, 0.5);
                break;

            }

            case 'ignore-limits': {

                this._setIgnoreLimits(this.ignoreLimits, true);
                break;

            }

        }

    }

    /* Public API */
    updateSize() {

        const w = this.clientWidth;
        const h = this.clientHeight;

        if (w > 0 && h > 0) {

            this._canvas.width = w * window.devicePixelRatio;
            this._canvas.height = h * window.devicePixelRatio;
            this.engine.resize();

        }

    }

    redraw() {

        this._dirty = true;
    }

    recenter() {

        this._updateEnvironment();
        this.redraw();

    }

    // Set the joint with jointName to
    // angle in degrees
    setJointValue(jointName, ...values) {

        if (!this.robot) return;
        if (!this.robot.joints[jointName]) return;

        if (this.robot.joints[jointName].setJointValue(...values)) {

            this.redraw();
            this.dispatchEvent(new CustomEvent('angle-change', { bubbles: true, cancelable: true, detail: jointName }));

        }

    }

    setJointValues(values) {

        for (const name in values) {

            if (Array.isArray(values[name])) {

                this.setJointValue(name, ...values[name]);

            } else {

                this.setJointValue(name, values[name]);

            }

        }

    }

    /* Private Functions */
    _updateEnvironment() {

        const robot = this.robot;
        if (!robot) return;

        // Compute bounding info from visual meshes
        let min = new Vector3(Infinity, Infinity, Infinity);
        let max = new Vector3(-Infinity, -Infinity, -Infinity);

        const processNode = (node) => {

            if (node.getBoundingInfo && node instanceof Mesh && node.getTotalVertices() > 0) {

                node.computeWorldMatrix(true);
                const bi = node.getBoundingInfo();
                min = Vector3.Minimize(min, bi.boundingBox.minimumWorld);
                max = Vector3.Maximize(max, bi.boundingBox.maximumWorld);

            }
            if (node.getChildren) {

                node.getChildren().forEach(processNode);

            }

        };

        robot.traverse(c => {
            if (c.isURDFVisual) {

                processNode(c);

            }
        });

        if (min.x === Infinity) return;

        const center = Vector3.Center(min, max);
        this.camera.target.y = center.y;
        this.ground.position.y = min.y - 1e-3;

        const dirLight = this.directionalLight;

        if (this.displayShadow) {

            const radius = Vector3.Distance(min, max) / 2;
            dirLight.shadowMinZ = -radius * 3;
            dirLight.shadowMaxZ = radius * 3;

        }

    }

    _scheduleLoad() {

        // if our current model is already what's being requested
        // or has been loaded then early out
        if (this._prevload === `${ this.package }|${ this.urdf }`) return;
        this._prevload = `${ this.package }|${ this.urdf }`;

        // if we're already waiting on a load then early out
        if (this._loadScheduled) return;
        this._loadScheduled = true;

        if (this.robot) {

            this.robot.traverse(c => c.dispose && c.dispose());
            this.robot = null;

        }

        requestAnimationFrame(() => {

            this._loadUrdf(this.package, this.urdf);
            this._loadScheduled = false;

        });

    }

    // Watch the package and urdf field and load the robot model.
    // This should _only_ be called from _scheduleLoad because that
    // ensures the that current robot has been removed
    _loadUrdf(pkg, urdf) {

        this.dispatchEvent(new CustomEvent('urdf-change', { bubbles: true, cancelable: true, composed: true }));

        if (urdf) {

            // Keep track of this request and make
            // sure it doesn't get overwritten by
            // a subsequent one
            this._requestId++;
            const requestId = this._requestId;

            const updateMaterials = mesh => {

                mesh.traverse(c => {

                    if (c instanceof Mesh) {

                        // Add to shadow generator
                        this._shadowGenerator.addShadowCaster(c);
                        c.receiveShadows = true;

                    }

                });

            };

            if (pkg.includes(':') && (pkg.split(':')[1].substring(0, 2)) !== '//') {

                pkg = pkg.split(',').reduce((map, value) => {

                    const split = value.split(/:/).filter(x => !!x);
                    const pkgName = split.shift().trim();
                    const pkgPath = split.join(':').trim();
                    map[pkgName] = pkgPath;

                    return map;

                }, {});
            }

            let robot = null;
            const loader = new URDFLoader(this.scene);
            loader.packages = pkg;
            if (this.loadMeshFunc) {

                loader.loadMeshCb = this.loadMeshFunc;

            }
            loader.fetchOptions = { mode: 'cors', credentials: 'same-origin' };
            loader.parseCollision = true;

            loader.manager.onLoad = () => {

                // If another request has come in to load a new
                // robot, then ignore this one
                if (this._requestId !== requestId) {

                    if (robot) robot.traverse(c => c.dispose && c.dispose());
                    return;

                }

                this.robot = robot;
                robot.parent = this.world;
                updateMaterials(robot);

                this._setIgnoreLimits(this.ignoreLimits);
                this._updateCollisionVisibility();

                this.dispatchEvent(new CustomEvent('urdf-processed', { bubbles: true, cancelable: true, composed: true }));
                this.dispatchEvent(new CustomEvent('geometry-loaded', { bubbles: true, cancelable: true, composed: true }));

                this.recenter();

            };

            loader.load(urdf, model => robot = model);

        }

    }

    _updateCollisionVisibility() {

        const showCollision = this.showCollision;
        const collisionMaterial = this._collisionMaterial;
        const robot = this.robot;

        if (robot === null) return;

        const colliders = [];
        robot.traverse(c => {

            if (c.isURDFCollider) {

                c.setEnabled(showCollision);
                colliders.push(c);

            }

        });

        colliders.forEach(coll => {

            coll.traverse(c => {

                if (c instanceof Mesh) {

                    c.isPickable = false;
                    c.material = collisionMaterial;

                }

            });

        });

    }

    // Watch the coordinate frame and update the
    // rotation of the scene to match
    _setUp(up) {

        if (!up) up = '+Z';
        up = up.toUpperCase();
        const sign = up.replace(/[^-+]/g, '')[0] || '+';
        const axis = up.replace(/[^XYZ]/gi, '')[0] || 'Z';

        if (!this.world) return;

        const PI = Math.PI;
        const HALFPI = PI / 2;

        let rx = 0, rz = 0;
        const ry = 0;
        if (axis === 'X') { rz = sign === '+' ? HALFPI : -HALFPI; }
        if (axis === 'Z') { rx = sign === '+' ? -HALFPI : HALFPI; }
        if (axis === 'Y') { rx = sign === '+' ? 0 : PI; }

        this.world.rotationQuaternion = Quaternion.RotationYawPitchRoll(ry, rx, rz);

    }

    // Updates the current robot's angles to ignore
    // joint limits or not
    _setIgnoreLimits(ignore, dispatch = false) {

        if (this.robot) {

            Object
                .values(this.robot.joints)
                .forEach(joint => {

                    joint.ignoreLimits = ignore;
                    joint.setJointValue(...joint.jointValue);

                });

        }

        if (dispatch) {

            this.dispatchEvent(new CustomEvent('ignore-limits-change', { bubbles: true, cancelable: true, composed: true }));

        }

    }

}
