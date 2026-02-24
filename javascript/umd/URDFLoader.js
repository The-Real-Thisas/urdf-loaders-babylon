(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('@babylonjs/core'), require('@babylonjs/loaders/STL/stlFileLoader.js'), require('@babylonjs/loaders/glTF')) :
    typeof define === 'function' && define.amd ? define(['@babylonjs/core', '@babylonjs/loaders/STL/stlFileLoader.js', '@babylonjs/loaders/glTF'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.URDFLoader = factory(global.BABYLON, global.BABYLON));
})(this, (function (core, stlFileLoader_js) { 'use strict';

    const _tempAxis = new core.Vector3();
    const _tempQuat = new core.Quaternion();
    const _tempQuat2 = new core.Quaternion();
    const _tempScale = new core.Vector3(1.0, 1.0, 1.0);
    const _tempPosition = new core.Vector3();
    const _tempMatrix = new core.Matrix();
    const _tempOrigMatrix = new core.Matrix();

    class URDFBase extends core.TransformNode {

        constructor(name = '', scene = null) {

            super(name, scene);
            this.rotationQuaternion = new core.Quaternion();
            this.urdfNode = null;
            this.urdfName = '';

        }

        // Depth-first traverse matching Three.js behavior
        traverse(callback) {

            callback(this);
            for (const child of this.getChildren()) {

                if (child.traverse) {

                    child.traverse(callback);

                } else {

                    callback(child);

                }

            }

        }

        copy(source, recursive) {

            this.urdfNode = source.urdfNode;
            this.urdfName = source.urdfName;

            this.name = source.name;
            this.position.copyFrom(source.position);
            if (source.rotationQuaternion) {

                if (!this.rotationQuaternion) {

                    this.rotationQuaternion = new core.Quaternion();

                }
                this.rotationQuaternion.copyFrom(source.rotationQuaternion);

            }
            this.scaling.copyFrom(source.scaling);

            if (recursive) {

                const children = source.getChildren();
                for (const child of children) {

                    let clonedChild;
                    if (child._clone && child instanceof URDFBase) {

                        clonedChild = child._clone();

                    } else if (child.clone) {

                        // For non-URDF nodes (e.g., Babylon.js Mesh), use native clone
                        clonedChild = child.clone(child.name);

                    }
                    if (clonedChild) {

                        clonedChild.parent = this;

                    }

                }

            }

            return this;

        }

        clone(name, newParent) {

            const cloned = this._clone();
            if (newParent) {

                cloned.parent = newParent;

            }
            return cloned;

        }

        _clone() {

            const cloned = new this.constructor(this.name, this.getScene());
            cloned.copy(this, true);
            return cloned;

        }

    }

    class URDFCollider extends URDFBase {

        constructor(name = '', scene = null) {

            super(name, scene);
            this.isURDFCollider = true;
            this.type = 'URDFCollider';

        }

    }

    class URDFVisual extends URDFBase {

        constructor(name = '', scene = null) {

            super(name, scene);
            this.isURDFVisual = true;
            this.type = 'URDFVisual';

        }

    }

    class URDFLink extends URDFBase {

        constructor(name = '', scene = null) {

            super(name, scene);
            this.isURDFLink = true;
            this.type = 'URDFLink';

        }

    }

    class URDFJoint extends URDFBase {

        get jointType() {

            return this._jointType;

        }

        set jointType(v) {

            if (this.jointType === v) return;
            this._jointType = v;
            switch (v) {

                case 'fixed':
                    this.jointValue = [];
                    break;

                case 'continuous':
                case 'revolute':
                case 'prismatic':
                    this.jointValue = new Array(1).fill(0);
                    break;

                case 'planar':
                    // Planar joints are, 3dof: position XY and rotation Z.
                    this.jointValue = new Array(3).fill(0);
                    this.axis = new core.Vector3(0, 0, 1);
                    break;

                case 'floating':
                    this.jointValue = new Array(6).fill(0);
                    break;

            }

        }

        get angle() {

            return this.jointValue[0];

        }

        constructor(name = '', scene = null) {

            super(name, scene);

            this.isURDFJoint = true;
            this.type = 'URDFJoint';

            this.jointValue = null;
            this.jointType = 'fixed';
            this.axis = new core.Vector3(1, 0, 0);
            this.limit = { lower: 0, upper: 0 };
            this.ignoreLimits = false;

            this.origPosition = null;
            this.origQuaternion = null;

            this.mimicJoints = [];

        }

        /* Overrides */
        copy(source, recursive) {

            super.copy(source, recursive);

            this.jointType = source.jointType;
            this.axis = source.axis.clone();
            this.limit.lower = source.limit.lower;
            this.limit.upper = source.limit.upper;
            this.ignoreLimits = false;

            this.jointValue = [...source.jointValue];

            this.origPosition = source.origPosition ? source.origPosition.clone() : null;
            this.origQuaternion = source.origQuaternion ? source.origQuaternion.clone() : null;

            this.mimicJoints = [...source.mimicJoints];

            return this;

        }

        /* Public Functions */
        /**
         * @param {...number|null} values The joint value components to set, optionally null for no-op
         * @returns {boolean} Whether the invocation of this function resulted in an actual change to the joint value
         */
        setJointValue(...values) {

            // Parse all incoming values into numbers except null, which we treat as a no-op for that value component.
            values = values.map(v => v === null ? null : parseFloat(v));

            if (!this.origPosition || !this.origQuaternion) {

                this.origPosition = this.position.clone();
                this.origQuaternion = this.rotationQuaternion.clone();

            }

            let didUpdate = false;

            this.mimicJoints.forEach(joint => {

                didUpdate = joint.updateFromMimickedJoint(...values) || didUpdate;

            });

            switch (this.jointType) {

                case 'fixed': {

                    return didUpdate;

                }
                case 'continuous':
                case 'revolute': {

                    let angle = values[0];
                    if (angle == null) return didUpdate;
                    if (angle === this.jointValue[0]) return didUpdate;

                    if (!this.ignoreLimits && this.jointType === 'revolute') {

                        angle = Math.min(this.limit.upper, angle);
                        angle = Math.max(this.limit.lower, angle);

                    }

                    // Three.js: this.quaternion.setFromAxisAngle(this.axis, angle).premultiply(this.origQuaternion);
                    // premultiply(q) means result = q * this
                    // So: result = origQuaternion * RotationAxis(axis, angle)
                    const rotQuat = core.Quaternion.RotationAxis(this.axis, angle);
                    this.origQuaternion.multiplyToRef(rotQuat, this.rotationQuaternion);

                    if (this.jointValue[0] !== angle) {

                        this.jointValue[0] = angle;
                        this.computeWorldMatrix(true);
                        return true;

                    } else {

                        return didUpdate;

                    }

                }

                case 'prismatic': {

                    let pos = values[0];
                    if (pos == null) return didUpdate;
                    if (pos === this.jointValue[0]) return didUpdate;

                    if (!this.ignoreLimits) {

                        pos = Math.min(this.limit.upper, pos);
                        pos = Math.max(this.limit.lower, pos);

                    }

                    this.position.copyFrom(this.origPosition);
                    // Rotate axis by the original rotation quaternion
                    const rotMatrix = new core.Matrix();
                    core.Matrix.FromQuaternionToRef(this.origQuaternion, rotMatrix);
                    core.Vector3.TransformNormalToRef(this.axis, rotMatrix, _tempAxis);
                    this.position.addInPlace(_tempAxis.scale(pos));

                    if (this.jointValue[0] !== pos) {

                        this.jointValue[0] = pos;
                        this.computeWorldMatrix(true);
                        return true;

                    } else {

                        return didUpdate;

                    }

                }

                case 'floating': {

                    // no-op if all values are identical to existing value or are null
                    if (this.jointValue.every((value, index) => values[index] === value || values[index] === null)) return didUpdate;
                    // Floating joints have six degrees of freedom: X, Y, Z, R, P, Y.
                    this.jointValue[0] = values[0] !== null ? values[0] : this.jointValue[0];
                    this.jointValue[1] = values[1] !== null ? values[1] : this.jointValue[1];
                    this.jointValue[2] = values[2] !== null ? values[2] : this.jointValue[2];
                    this.jointValue[3] = values[3] !== null ? values[3] : this.jointValue[3];
                    this.jointValue[4] = values[4] !== null ? values[4] : this.jointValue[4];
                    this.jointValue[5] = values[5] !== null ? values[5] : this.jointValue[5];

                    // Compose transform of joint origin and transform due to joint values
                    // Three.js: Matrix4.compose(pos, quat, scale) -> Babylon: Matrix.Compose(scale, quat, pos)
                    core.Matrix.ComposeToRef(_tempScale, this.origQuaternion, this.origPosition, _tempOrigMatrix);

                    // Three.js Euler('XYZ') -> compose quaternion from axis rotations
                    // XYZ intrinsic = Qz * Qy * Qx
                    const qx = core.Quaternion.RotationAxis(new core.Vector3(1, 0, 0), this.jointValue[3]);
                    const qy = core.Quaternion.RotationAxis(new core.Vector3(0, 1, 0), this.jointValue[4]);
                    const qz = core.Quaternion.RotationAxis(new core.Vector3(0, 0, 1), this.jointValue[5]);
                    // XYZ order: apply X first, then Y, then Z -> qz * qy * qx
                    qz.multiplyToRef(qy, _tempQuat);
                    _tempQuat.multiplyToRef(qx, _tempQuat2);

                    _tempPosition.set(this.jointValue[0], this.jointValue[1], this.jointValue[2]);
                    core.Matrix.ComposeToRef(_tempScale, _tempQuat2, _tempPosition, _tempMatrix);

                    // Three.js: _tempOrigTransform.premultiply(_tempTransform) means _tempTransform * _tempOrigTransform
                    _tempMatrix.multiplyToRef(_tempOrigMatrix, _tempOrigMatrix);

                    // Decompose: Babylon decompose(scale, rotation, translation)
                    _tempOrigMatrix.decompose(_tempScale, _tempQuat, _tempPosition);
                    this.position.copyFrom(_tempPosition);
                    this.rotationQuaternion.copyFrom(_tempQuat);

                    // Reset temp scale
                    _tempScale.set(1, 1, 1);

                    this.computeWorldMatrix(true);
                    return true;
                }

                case 'planar': {

                    // no-op if all values are identical to existing value or are null
                    if (this.jointValue.every((value, index) => values[index] === value || values[index] === null)) return didUpdate;

                    this.jointValue[0] = values[0] !== null ? values[0] : this.jointValue[0];
                    this.jointValue[1] = values[1] !== null ? values[1] : this.jointValue[1];
                    this.jointValue[2] = values[2] !== null ? values[2] : this.jointValue[2];

                    // Compose transform of joint origin and transform due to joint values
                    core.Matrix.ComposeToRef(_tempScale, this.origQuaternion, this.origPosition, _tempOrigMatrix);
                    const axisQuat = core.Quaternion.RotationAxis(this.axis, this.jointValue[2]);
                    _tempPosition.set(this.jointValue[0], this.jointValue[1], 0.0);
                    core.Matrix.ComposeToRef(_tempScale, axisQuat, _tempPosition, _tempMatrix);

                    // Calculate new transform: premultiply means _tempTransform * _tempOrigTransform
                    _tempMatrix.multiplyToRef(_tempOrigMatrix, _tempOrigMatrix);

                    _tempOrigMatrix.decompose(_tempScale, _tempQuat, _tempPosition);
                    this.position.copyFrom(_tempPosition);
                    this.rotationQuaternion.copyFrom(_tempQuat);

                    // Reset temp scale
                    _tempScale.set(1, 1, 1);

                    this.computeWorldMatrix(true);
                    return true;
                }

            }

            return didUpdate;

        }

    }

    class URDFMimicJoint extends URDFJoint {

        constructor(name = '', scene = null) {

            super(name, scene);
            this.type = 'URDFMimicJoint';
            this.mimicJoint = null;
            this.offset = 0;
            this.multiplier = 1;

        }

        updateFromMimickedJoint(...values) {

            const modifiedValues = values.map(x => x * this.multiplier + this.offset);
            return super.setJointValue(...modifiedValues);

        }

        /* Overrides */
        copy(source, recursive) {

            super.copy(source, recursive);

            this.mimicJoint = source.mimicJoint;
            this.offset = source.offset;
            this.multiplier = source.multiplier;

            return this;

        }

    }

    class URDFRobot extends URDFLink {

        constructor(name = '', scene = null) {

            super(name, scene);
            this.isURDFRobot = true;
            this.urdfNode = null;

            this.urdfRobotNode = null;
            this.robotName = null;

            this.links = null;
            this.joints = null;
            this.colliders = null;
            this.visual = null;
            this.frames = null;

        }

        copy(source, recursive) {

            super.copy(source, recursive);

            this.urdfRobotNode = source.urdfRobotNode;
            this.robotName = source.robotName;

            this.links = {};
            this.joints = {};
            this.colliders = {};
            this.visual = {};

            this.traverse(c => {

                if (c.isURDFJoint && c.urdfName in source.joints) {

                    this.joints[c.urdfName] = c;

                }

                if (c.isURDFLink && c.urdfName in source.links) {

                    this.links[c.urdfName] = c;

                }

                if (c.isURDFCollider && c.urdfName in source.colliders) {

                    this.colliders[c.urdfName] = c;

                }

                if (c.isURDFVisual && c.urdfName in source.visual) {

                    this.visual[c.urdfName] = c;

                }

            });

            // Repair mimic joint references once we've re-accumulated all our joint data
            for (const joint in this.joints) {
                this.joints[joint].mimicJoints = this.joints[joint].mimicJoints.map((mimicJoint) => this.joints[mimicJoint.name]);
            }

            this.frames = {
                ...this.colliders,
                ...this.visual,
                ...this.links,
                ...this.joints,
            };

            return this;

        }

        getFrame(name) {

            return this.frames[name];

        }

        setJointValue(jointName, ...angle) {

            const joint = this.joints[jointName];
            if (joint) {

                return joint.setJointValue(...angle);

            }

            return false;
        }

        setJointValues(values) {

            let didChange = false;
            for (const name in values) {

                const value = values[name];
                if (Array.isArray(value)) {

                    didChange = this.setJointValue(name, ...value) || didChange;

                } else {

                    didChange = this.setJointValue(name, value) || didChange;

                }

            }

            return didChange;

        }

    }

    // Prevent Y/Z axis swap — URDF coordinates should be used as-is in a right-handed scene
    stlFileLoader_js.STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true;

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

    const tempQuaternion = new core.Quaternion();

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

            obj.rotationQuaternion = new core.Quaternion();

        }

        // URDF uses ZYX Euler order (intrinsic)
        // ZYX intrinsic = Qz * Qy * Qx
        const qx = core.Quaternion.RotationAxis(new core.Vector3(1, 0, 0), rpy[0]);
        const qy = core.Quaternion.RotationAxis(new core.Vector3(0, 1, 0), rpy[1]);
        const qz = core.Quaternion.RotationAxis(new core.Vector3(0, 0, 1), rpy[2]);
        const rpyQuat = qz.multiply(qy).multiply(qx);

        rpyQuat.multiplyToRef(obj.rotationQuaternion, tempQuaternion);
        obj.rotationQuaternion.copyFrom(tempQuaternion);

    }

    /* URDFLoader Class */
    // Loads and reads a URDF file into a Babylon.js TransformNode format
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
                    onComplete(model);
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
            const packages = this.packages;
            const loadMeshCb = this.loadMeshCb;
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
                    obj.axis = new core.Vector3(axisXYZ[0], axisXYZ[1], axisXYZ[2]);
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
                const material = new core.StandardMaterial(node.getAttribute('name') || '', scene);

                material.name = node.getAttribute('name') || '';
                matNodes.forEach(n => {

                    const type = n.nodeName.toLowerCase();
                    if (type === 'color') {

                        const rgba =
                            n
                                .getAttribute('rgba')
                                .split(/\s/g)
                                .map(v => parseFloat(v));

                        material.diffuseColor = new core.Color3(rgba[0], rgba[1], rgba[2]);
                        material.alpha = rgba[3];
                        if (rgba[3] < 1) {

                            material.transparencyMode = core.Material.MATERIAL_ALPHABLEND;
                            material.disableDepthWrite = true;

                        }

                    } else if (type === 'texture') {

                        // The URDF spec does not require that the <texture/> tag include
                        // a filename attribute so skip loading the texture if not provided.
                        const filename = n.getAttribute('filename');
                        if (filename) {

                            const filePath = resolvePath(filename);
                            material.diffuseTexture = new core.Texture(filePath, scene);

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

                    material = new core.StandardMaterial('', scene);

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

                                loadMeshCb(filePath, scene, (obj, err) => {

                                    if (err) {

                                        console.error('URDFLoader: Error loading mesh.', err);

                                    } else if (obj) {

                                        if (obj instanceof core.Mesh) {

                                            obj.material = material;

                                        }

                                        // We don't expect non identity rotations or positions.
                                        obj.position.set(0, 0, 0);
                                        if (obj.rotationQuaternion) {

                                            obj.rotationQuaternion.copyFrom(core.Quaternion.Identity());

                                        }
                                        obj.parent = group;

                                    }

                                });

                            }

                        } else if (geoType === 'box') {

                            const primitiveModel = core.MeshBuilder.CreateBox('box', { size: 1 }, scene);
                            primitiveModel.material = material;

                            const size = processTuple(n.children[0].getAttribute('size'));
                            primitiveModel.scaling.set(size[0], size[1], size[2]);

                            primitiveModel.parent = group;

                        } else if (geoType === 'sphere') {

                            const primitiveModel = core.MeshBuilder.CreateSphere('sphere', { diameter: 2, segments: 30 }, scene);
                            primitiveModel.material = material;

                            const radius = parseFloat(n.children[0].getAttribute('radius')) || 0;
                            primitiveModel.scaling.set(radius, radius, radius);

                            primitiveModel.parent = group;

                        } else if (geoType === 'cylinder') {

                            const primitiveModel = core.MeshBuilder.CreateCylinder('cylinder', { diameter: 2, height: 1, tessellation: 30 }, scene);
                            primitiveModel.material = material;

                            const radius = parseFloat(n.children[0].getAttribute('radius')) || 0;
                            const length = parseFloat(n.children[0].getAttribute('length')) || 0;
                            // Three.js cylinder is Y-up, Babylon.js cylinder is also Y-up
                            // Three.js original: scale(radius, length, radius), rotation(PI/2, 0, 0)
                            // The rotation makes the cylinder lie along the Z axis (URDF convention)
                            primitiveModel.scaling.set(radius, length, radius);
                            primitiveModel.rotationQuaternion = core.Quaternion.RotationAxis(new core.Vector3(1, 0, 0), Math.PI / 2);

                            primitiveModel.parent = group;

                        }

                    } else if (type === 'origin') {

                        const xyz = processTuple(n.getAttribute('xyz'));
                        const rpy = processTuple(n.getAttribute('rpy'));

                        group.position.set(xyz[0], xyz[1], xyz[2]);
                        group.rotationQuaternion = new core.Quaternion();
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

                core.SceneLoader.ImportMesh('', rootUrl, fileName, scene, (meshes) => {

                    if (meshes.length > 0) {

                        // If multiple meshes, create a parent node
                        if (meshes.length === 1) {

                            const mesh = meshes[0];
                            mesh.material = new core.StandardMaterial('stl-material', scene);
                            done(mesh);

                        } else {

                            const parent = new (core.Mesh.bind(core.Mesh, 'stl-root', scene))();
                            meshes.forEach(m => {

                                m.material = new core.StandardMaterial('stl-material', scene);
                                m.parent = parent;

                            });
                            done(parent);

                        }

                    }

                }, null, (scene, message, exception) => {

                    console.warn(`URDFLoader: Could not load STL at ${ path }.`, message);
                    done(null, exception || new Error(message));

                });

            } else if (/\.(glb|gltf)$/i.test(path)) {

                const rootUrl = path.substring(0, path.lastIndexOf('/') + 1);
                const fileName = path.substring(path.lastIndexOf('/') + 1);

                core.SceneLoader.ImportMesh('', rootUrl, fileName, scene, (meshes) => {

                    if (meshes.length === 1) {

                        done(meshes[0]);

                    } else if (meshes.length > 1) {

                        const parent = new (core.Mesh.bind(core.Mesh, 'gltf-root', scene))();
                        meshes.forEach(m => { m.parent = parent; });
                        done(parent);

                    }

                }, null, (scene, message, exception) => {

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

    return URDFLoader;

}));
//# sourceMappingURL=URDFLoader.js.map
