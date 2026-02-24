import { TransformNode, Vector3, Quaternion, Matrix } from '@babylonjs/core';

const _tempAxis = new Vector3();
const _tempQuat = new Quaternion();
const _tempQuat2 = new Quaternion();
const _tempScale = new Vector3(1.0, 1.0, 1.0);
const _tempPosition = new Vector3();
const _tempMatrix = new Matrix();
const _tempOrigMatrix = new Matrix();

class URDFBase extends TransformNode {

    constructor(name = '', scene = null) {

        super(name, scene);
        this.rotationQuaternion = new Quaternion();
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

                this.rotationQuaternion = new Quaternion();

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
                this.axis = new Vector3(0, 0, 1);
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
        this.axis = new Vector3(1, 0, 0);
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
                const rotQuat = Quaternion.RotationAxis(this.axis, angle);
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
                const rotMatrix = new Matrix();
                Matrix.FromQuaternionToRef(this.origQuaternion, rotMatrix);
                Vector3.TransformNormalToRef(this.axis, rotMatrix, _tempAxis);
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
                Matrix.ComposeToRef(_tempScale, this.origQuaternion, this.origPosition, _tempOrigMatrix);

                // Three.js Euler('XYZ') -> compose quaternion from axis rotations
                // XYZ intrinsic = Qz * Qy * Qx
                const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), this.jointValue[3]);
                const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), this.jointValue[4]);
                const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), this.jointValue[5]);
                // XYZ order: apply X first, then Y, then Z -> qz * qy * qx
                qz.multiplyToRef(qy, _tempQuat);
                _tempQuat.multiplyToRef(qx, _tempQuat2);

                _tempPosition.set(this.jointValue[0], this.jointValue[1], this.jointValue[2]);
                Matrix.ComposeToRef(_tempScale, _tempQuat2, _tempPosition, _tempMatrix);

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
                Matrix.ComposeToRef(_tempScale, this.origQuaternion, this.origPosition, _tempOrigMatrix);
                const axisQuat = Quaternion.RotationAxis(this.axis, this.jointValue[2]);
                _tempPosition.set(this.jointValue[0], this.jointValue[1], 0.0);
                Matrix.ComposeToRef(_tempScale, axisQuat, _tempPosition, _tempMatrix);

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

export { URDFRobot, URDFLink, URDFJoint, URDFMimicJoint, URDFVisual, URDFCollider };
