import { StandardMaterial, Color3, Texture, MeshBuilder, Mesh, Vector3, Quaternion, Material, SceneLoader } from '@babylonjs/core';
import { STLFileLoader } from '@babylonjs/loaders/STL/stlFileLoader.js';
import '@babylonjs/loaders/glTF';

// Prevent Y/Z axis swap — URDF coordinates should be used as-is in a right-handed scene
STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true;
import { URDFRobot, URDFJoint, URDFLink, URDFCollider, URDFVisual, URDFMimicJoint } from './URDFClasses.js';

/*
Reference coordinate frames for Babylon.js and ROS.
Babylon.js is LEFT-handed, ROS/URDF is RIGHT-handed.
To handle this, apply scaling (1, 1, -1) on the robot root node
(handled in the viewer component).

Babylon.js
   Y
   |
   |
   .-----X
    \
     Z (into screen, left-handed)

ROS URDF
       Z
       |   X
       | /
 Y-----.

*/

const tempQuaternion = new Quaternion();

// Simple load tracker replacing THREE.LoadingManager
class LoadTracker {

    constructor() {

        this._pending = 0;
        this.onLoad = null;

    }

    itemStart() {

        this._pending++;

    }

    itemEnd() {

        this._pending--;
        if (this._pending === 0 && this.onLoad) {

            this.onLoad();

        }

    }

    itemError(url) {

        console.error(`URDFLoader: Failed to load: ${ url }`);

    }

}

// take a vector "x y z" and process it into
// an array [x, y, z]
function processTuple(val) {

    if (!val) return [0, 0, 0];
    return val.trim().split(/\s+/g).map(num => parseFloat(num));

}

// Extract the base URL from a full URL path
function extractUrlBase(url) {

    return url.substring(0, url.lastIndexOf('/') + 1);

}

// applies a rotation to a Babylon.js node in URDF order
function applyRotation(obj, rpy, additive = false) {

    // if additive is true the rotation is applied in
    // addition to the existing rotation
    if (!additive) {

        obj.rotationQuaternion = new Quaternion();

    }

    // URDF uses ZYX Euler order (intrinsic)
    // ZYX intrinsic = Qz * Qy * Qx
    const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), rpy[0]);
    const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), rpy[1]);
    const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), rpy[2]);
    const rpyQuat = qz.multiply(qy).multiply(qx);

    rpyQuat.multiplyToRef(obj.rotationQuaternion, tempQuaternion);
    obj.rotationQuaternion.copyFrom(tempQuaternion);

}

/* URDFLoader Class */
// Loads and reads a URDF file into a Babylon.js TransformNode format
export default
class URDFLoader {

    constructor(scene) {

        this.scene = scene || null;
        this.manager = new LoadTracker();
        this.loadMeshCb = this.defaultMeshLoader.bind(this);
        this.parseVisual = true;
        this.parseCollision = false;
        this.packages = '';
        this.workingPath = '';
        this.fetchOptions = {};
        // Optional hook: (mesh, originalMaterial) => void. Called once per
        // mesh produced by defaultMeshLoader, after the mesh exists and its
        // original material is assigned (StandardMaterial for STL; the glTF
        // loader's material for GLB/GLTF). Consumers can inspect the source
        // material (e.g. baseColor) and swap mesh.material in place.
        this.onMeshLoaded = null;

    }

    /* Public API */
    loadAsync(urdf) {

        return new Promise((resolve, reject) => {

            this.load(urdf, resolve, null, reject);

        });

    }

    // urdf:    The path to the URDF within the package OR absolute
    // onComplete:      Callback that is passed the model once loaded
    load(urdf, onComplete, onProgress, onError) {

        const manager = this.manager;
        const workingPath = extractUrlBase(urdf);
        const urdfPath = urdf;

        manager.itemStart();

        fetch(urdfPath, this.fetchOptions)
            .then(res => {

                if (res.ok) {

                    if (onProgress) {

                        onProgress(null);

                    }
                    return res.text();

                } else {

                    throw new Error(`URDFLoader: Failed to load url '${ urdfPath }' with error code ${ res.status } : ${ res.statusText }.`);

                }

            })
            .then(data => {

                const model = this.parse(data, this.workingPath || workingPath);
                // Defer onComplete until every mesh load tracked by the
                // LoadTracker has also finished. parse() kicks off async
                // loadMeshCb calls that increment pending; onLoad fires when
                // pending returns to zero after our own itemEnd below.
                manager.onLoad = () => { onComplete(model); };
                manager.itemEnd();

            })
            .catch(e => {

                if (onError) {

                    onError(e);

                } else {

                    console.error('URDFLoader: Error loading file.', e);

                }
                manager.itemError(urdfPath);
                manager.itemEnd();

            });

    }

    parse(content, workingPath = this.workingPath) {

        const scene = this.scene;
        const manager = this.manager;
        const packages = this.packages;
        const loadMeshCb = this.loadMeshCb;
        const onMeshLoaded = this.onMeshLoaded;
        const parseVisual = this.parseVisual;
        const parseCollision = this.parseCollision;
        const linkMap = {};
        const jointMap = {};
        const materialMap = {};

        // Resolves the path of mesh files
        function resolvePath(path) {

            if (!/^package:\/\//.test(path)) {

                return workingPath ? workingPath + path : path;

            }

            // Remove "package://" keyword and split meshPath at the first slash
            const [targetPkg, relPath] = path.replace(/^package:\/\//, '').split(/\/(.+)/);

            if (typeof packages === 'string') {

                // "pkg" is one single package
                if (packages.endsWith(targetPkg)) {

                    // "pkg" is the target package
                    return packages + '/' + relPath;

                } else {

                    // Assume "pkg" is the target package's parent directory
                    return packages + '/' + targetPkg + '/' + relPath;

                }

            } else if (packages instanceof Function) {

                return packages(targetPkg) + '/' + relPath;

            } else if (typeof packages === 'object') {

                // "pkg" is a map of packages
                if (targetPkg in packages) {

                    return packages[targetPkg] + '/' + relPath;

                } else {

                    console.error(`URDFLoader : ${ targetPkg } not found in provided package list.`);
                    return null;

                }

            }

        }

        // Process the URDF text format
        function processUrdf(data) {

            let children;
            if (data instanceof Document) {

                children = [ ...data.children ];

            } else if (data instanceof Element) {

                children = [ data ];

            } else {

                const parser = new DOMParser();
                const urdf = parser.parseFromString(data, 'text/xml');
                children = [ ...urdf.children ];

            }

            const robotNode = children.filter(c => c.nodeName === 'robot').pop();
            return processRobot(robotNode);

        }

        // Process the <robot> node
        function processRobot(robot) {

            const robotNodes = [ ...robot.children ];
            const links = robotNodes.filter(c => c.nodeName.toLowerCase() === 'link');
            const joints = robotNodes.filter(c => c.nodeName.toLowerCase() === 'joint');
            const materials = robotNodes.filter(c => c.nodeName.toLowerCase() === 'material');
            const obj = new URDFRobot('', scene);

            obj.robotName = robot.getAttribute('name');
            obj.urdfRobotNode = robot;

            // Create the <material> map
            materials.forEach(m => {

                const name = m.getAttribute('name');
                materialMap[name] = processMaterial(m);

            });

            // Create the <link> map
            const visualMap = {};
            const colliderMap = {};
            links.forEach(l => {

                const name = l.getAttribute('name');
                const isRoot = robot.querySelector(`child[link="${ name }"]`) === null;
                linkMap[name] = processLink(l, visualMap, colliderMap, isRoot ? obj : null);

            });

            // Create the <joint> map
            joints.forEach(j => {

                const name = j.getAttribute('name');
                jointMap[name] = processJoint(j);

            });

            obj.joints = jointMap;
            obj.links = linkMap;
            obj.colliders = colliderMap;
            obj.visual = visualMap;

            // Link up mimic joints
            const jointList = Object.values(jointMap);
            jointList.forEach(j => {

                if (j instanceof URDFMimicJoint) {

                    jointMap[j.mimicJoint].mimicJoints.push(j);

                }

            });

            // Detect infinite loops of mimic joints
            jointList.forEach(j => {

                const uniqueJoints = new Set();
                const iterFunction = joint => {

                    if (uniqueJoints.has(joint)) {

                        throw new Error('URDFLoader: Detected an infinite loop of mimic joints.');

                    }

                    uniqueJoints.add(joint);
                    joint.mimicJoints.forEach(j => {

                        iterFunction(j);

                    });

                };

                iterFunction(j);
            });

            obj.frames = {
                ...colliderMap,
                ...visualMap,
                ...linkMap,
                ...jointMap,
            };

            return obj;

        }

        // Process joint nodes and parent them
        function processJoint(joint) {

            const children = [ ...joint.children ];
            const jointType = joint.getAttribute('type');

            let obj;

            const mimicTag = children.find(n => n.nodeName.toLowerCase() === 'mimic');
            if (mimicTag) {

                obj = new URDFMimicJoint('', scene);
                obj.mimicJoint = mimicTag.getAttribute('joint');
                obj.multiplier = parseFloat(mimicTag.getAttribute('multiplier') || 1.0);
                obj.offset = parseFloat(mimicTag.getAttribute('offset') || 0.0);

            } else {

                obj = new URDFJoint('', scene);

            }

            obj.urdfNode = joint;
            obj.name = joint.getAttribute('name');
            obj.urdfName = obj.name;
            obj.jointType = jointType;

            let parent = null;
            let child = null;
            let xyz = [0, 0, 0];
            let rpy = [0, 0, 0];

            // Extract the attributes
            children.forEach(n => {

                const type = n.nodeName.toLowerCase();
                if (type === 'origin') {

                    xyz = processTuple(n.getAttribute('xyz'));
                    rpy = processTuple(n.getAttribute('rpy'));

                } else if (type === 'child') {

                    child = linkMap[n.getAttribute('link')];

                } else if (type === 'parent') {

                    parent = linkMap[n.getAttribute('link')];

                } else if (type === 'limit') {

                    obj.limit.lower = parseFloat(n.getAttribute('lower') || obj.limit.lower);
                    obj.limit.upper = parseFloat(n.getAttribute('upper') || obj.limit.upper);

                }
            });

            // Join the links - Babylon.js uses child.parent = parentNode
            obj.parent = parent;
            child.parent = obj;
            applyRotation(obj, rpy);
            obj.position.set(xyz[0], xyz[1], xyz[2]);

            // Set up the rotate function
            const axisNode = children.filter(n => n.nodeName.toLowerCase() === 'axis')[0];

            if (axisNode) {

                const axisXYZ = axisNode.getAttribute('xyz').split(/\s+/g).map(num => parseFloat(num));
                obj.axis = new Vector3(axisXYZ[0], axisXYZ[1], axisXYZ[2]);
                obj.axis.normalize();

            }

            return obj;

        }

        // Process the <link> nodes
        function processLink(link, visualMap, colliderMap, target = null) {

            if (target === null) {

                target = new URDFLink('', scene);

            }

            const children = [ ...link.children ];
            target.name = link.getAttribute('name');
            target.urdfName = target.name;
            target.urdfNode = link;

            if (parseVisual) {

                const visualNodes = children.filter(n => n.nodeName.toLowerCase() === 'visual');
                visualNodes.forEach(vn => {

                    const v = processLinkElement(vn, materialMap);
                    v.parent = target;

                    if (vn.hasAttribute('name')) {

                        const name = vn.getAttribute('name');
                        v.name = name;
                        v.urdfName = name;
                        visualMap[name] = v;

                    }

                });

            }

            if (parseCollision) {

                const collisionNodes = children.filter(n => n.nodeName.toLowerCase() === 'collision');
                collisionNodes.forEach(cn => {

                    const c = processLinkElement(cn);
                    c.parent = target;

                    if (cn.hasAttribute('name')) {

                        const name = cn.getAttribute('name');
                        c.name = name;
                        c.urdfName = name;
                        colliderMap[name] = c;

                    }

                });

            }

            return target;

        }

        function processMaterial(node) {

            const matNodes = [ ...node.children ];
            const material = new StandardMaterial(node.getAttribute('name') || '', scene);

            material.name = node.getAttribute('name') || '';
            matNodes.forEach(n => {

                const type = n.nodeName.toLowerCase();
                if (type === 'color') {

                    const rgba =
                        n
                            .getAttribute('rgba')
                            .split(/\s/g)
                            .map(v => parseFloat(v));

                    material.diffuseColor = new Color3(rgba[0], rgba[1], rgba[2]);
                    material.alpha = rgba[3];
                    if (rgba[3] < 1) {

                        material.transparencyMode = Material.MATERIAL_ALPHABLEND;
                        material.disableDepthWrite = true;

                    }

                } else if (type === 'texture') {

                    // The URDF spec does not require that the <texture/> tag include
                    // a filename attribute so skip loading the texture if not provided.
                    const filename = n.getAttribute('filename');
                    if (filename) {

                        const filePath = resolvePath(filename);
                        material.diffuseTexture = new Texture(filePath, scene);

                    }

                }
            });

            return material;

        }

        // Process the visual and collision nodes into meshes
        function processLinkElement(vn, materialMap = {}) {

            const isCollisionNode = vn.nodeName.toLowerCase() === 'collision';
            const children = [ ...vn.children ];
            let material = null;

            // get the material first
            const materialNode = children.filter(n => n.nodeName.toLowerCase() === 'material')[0];
            if (materialNode) {

                const name = materialNode.getAttribute('name');
                if (name && name in materialMap) {

                    material = materialMap[name];

                } else {

                    material = processMaterial(materialNode);

                }

            } else {

                material = new StandardMaterial('', scene);

            }

            const group = isCollisionNode ? new URDFCollider('', scene) : new URDFVisual('', scene);
            group.urdfNode = vn;

            children.forEach(n => {

                const type = n.nodeName.toLowerCase();
                if (type === 'geometry') {

                    const geoType = n.children[0].nodeName.toLowerCase();
                    if (geoType === 'mesh') {

                        const filename = n.children[0].getAttribute('filename');
                        const filePath = resolvePath(filename);

                        // file path is null if a package directory is not provided.
                        if (filePath !== null) {

                            const scaleAttr = n.children[0].getAttribute('scale');
                            if (scaleAttr) {

                                const scale = processTuple(scaleAttr);
                                group.scaling.set(scale[0], scale[1], scale[2]);

                            }

                            // Track each mesh load on the LoadTracker so
                            // `onLoad` fires only after all meshes have
                            // attached. Without this the top-level
                            // `onComplete` runs right after parse returns —
                            // before any async STL/GLB loads finish — so
                            // callers observe an empty robot tree and can't
                            // populate light include-lists, selection sets,
                            // etc. from the final mesh set.
                            manager.itemStart();
                            loadMeshCb(filePath, scene, (obj, err) => {

                                if (scene.isDisposed) {

                                    manager.itemEnd();
                                    return;

                                }

                                if (err) {

                                    console.error('URDFLoader: Error loading mesh.', err);

                                } else if (obj) {

                                    // Skip the URDF-material override when the
                                    // consumer has installed an onMeshLoaded
                                    // hook — they take full responsibility for
                                    // mesh materials (including per-primitive
                                    // handling for multi-mesh glTF imports).
                                    if (obj instanceof Mesh && !onMeshLoaded) {

                                        obj.material = material;

                                    }

                                    // We don't expect non identity rotations or positions.
                                    obj.position.set(0, 0, 0);
                                    if (obj.rotationQuaternion) {

                                        obj.rotationQuaternion.copyFrom(Quaternion.Identity());

                                    }
                                    obj.parent = group;

                                }

                                manager.itemEnd();

                            });

                        }

                    } else if (geoType === 'box') {

                        const primitiveModel = MeshBuilder.CreateBox('box', { size: 1 }, scene);
                        primitiveModel.material = material;

                        const size = processTuple(n.children[0].getAttribute('size'));
                        primitiveModel.scaling.set(size[0], size[1], size[2]);

                        primitiveModel.parent = group;

                    } else if (geoType === 'sphere') {

                        const primitiveModel = MeshBuilder.CreateSphere('sphere', { diameter: 2, segments: 30 }, scene);
                        primitiveModel.material = material;

                        const radius = parseFloat(n.children[0].getAttribute('radius')) || 0;
                        primitiveModel.scaling.set(radius, radius, radius);

                        primitiveModel.parent = group;

                    } else if (geoType === 'cylinder') {

                        const primitiveModel = MeshBuilder.CreateCylinder('cylinder', { diameter: 2, height: 1, tessellation: 30 }, scene);
                        primitiveModel.material = material;

                        const radius = parseFloat(n.children[0].getAttribute('radius')) || 0;
                        const length = parseFloat(n.children[0].getAttribute('length')) || 0;
                        // Three.js cylinder is Y-up, Babylon.js cylinder is also Y-up
                        // Three.js original: scale(radius, length, radius), rotation(PI/2, 0, 0)
                        // The rotation makes the cylinder lie along the Z axis (URDF convention)
                        primitiveModel.scaling.set(radius, length, radius);
                        primitiveModel.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);

                        primitiveModel.parent = group;

                    }

                } else if (type === 'origin') {

                    const xyz = processTuple(n.getAttribute('xyz'));
                    const rpy = processTuple(n.getAttribute('rpy'));

                    group.position.set(xyz[0], xyz[1], xyz[2]);
                    group.rotationQuaternion = new Quaternion();
                    applyRotation(group, rpy);

                }

            });

            return group;

        }

        return processUrdf(content);

    }

    // Default mesh loading function
    defaultMeshLoader(path, scene, done) {

        if (/\.stl$/i.test(path)) {

            const rootUrl = path.substring(0, path.lastIndexOf('/') + 1);
            const fileName = path.substring(path.lastIndexOf('/') + 1);

            SceneLoader.ImportMesh('', rootUrl, fileName, scene, (meshes) => {

                if (scene.isDisposed) return;

                if (meshes.length > 0) {

                    // If multiple meshes, create a parent node
                    if (meshes.length === 1) {

                        const mesh = meshes[0];
                        mesh.material = new StandardMaterial('stl-material', scene);
                        if (this.onMeshLoaded) this.onMeshLoaded(mesh, mesh.material);
                        done(mesh);

                    } else {

                        const parent = new (Mesh.bind(Mesh, 'stl-root', scene))();
                        meshes.forEach(m => {

                            m.material = new StandardMaterial('stl-material', scene);
                            if (this.onMeshLoaded) this.onMeshLoaded(m, m.material);
                            m.parent = parent;

                        });
                        done(parent);

                    }

                }

            }, null, (scene, message, exception) => {

                if (scene.isDisposed) return;

                console.warn(`URDFLoader: Could not load STL at ${ path }.`, message);
                done(null, exception || new Error(message));

            });

        } else if (/\.(glb|gltf)$/i.test(path)) {

            const rootUrl = path.substring(0, path.lastIndexOf('/') + 1);
            const fileName = path.substring(path.lastIndexOf('/') + 1);

            SceneLoader.ImportMesh('', rootUrl, fileName, scene, (meshes) => {

                if (scene.isDisposed) return;

                if (meshes.length === 1) {

                    if (this.onMeshLoaded) this.onMeshLoaded(meshes[0], meshes[0].material);
                    done(meshes[0]);

                } else if (meshes.length > 1) {

                    const parent = new (Mesh.bind(Mesh, 'gltf-root', scene))();
                    meshes.forEach(m => {

                        if (this.onMeshLoaded) this.onMeshLoaded(m, m.material);
                        m.parent = parent;

                    });
                    done(parent);

                }

            }, null, (scene, message, exception) => {

                if (scene.isDisposed) return;

                console.warn(`URDFLoader: Could not load glTF at ${ path }.`, message);
                done(null, exception || new Error(message));

            });

        } else if (/\.dae$/i.test(path)) {

            console.warn(`URDFLoader: DAE/COLLADA files are not supported in Babylon.js. Please convert to glTF: ${ path }`);
            done(null, new Error('DAE files not supported. Convert to glTF.'));

        } else {

            console.warn(`URDFLoader: Could not load model at ${ path }.\nNo loader available`);

        }

    }

}
