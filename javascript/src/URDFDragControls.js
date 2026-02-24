import { Vector3, Ray, Matrix } from '@babylonjs/core';

// Find the nearest parent that is a joint
function isJoint(j) {

    return j.isURDFJoint && j.jointType !== 'fixed';

}

function findNearestJoint(child) {

    let curr = child;
    while (curr) {

        if (isJoint(curr)) {

            return curr;

        }

        curr = curr.parent;

    }

    return curr;

}

// Project a point onto a plane defined by normal and d (ax + by + cz + d = 0)
function projectPointOnPlane(planeNormal, planeD, point) {

    const dist = Vector3.Dot(planeNormal, point) + planeD;
    return point.subtract(planeNormal.scale(dist));

}

const prevHitPoint = new Vector3();
const newHitPoint = new Vector3();
const pivotPoint = new Vector3();
const tempVector = new Vector3();
const tempVector2 = new Vector3();
const projectedStartPoint = new Vector3();
const projectedEndPoint = new Vector3();

// Simple plane representation: normal + d (ax + by + cz + d = 0)
let planeNormal = new Vector3();
let planeD = 0;

function setPlaneFromNormalAndPoint(normal, point) {

    planeNormal = normal.clone();
    planeD = -Vector3.Dot(normal, point);

}

export class URDFDragControls {

    constructor(scene) {

        this.enabled = true;
        this.scene = scene;
        this.ray = new Ray(Vector3.Zero(), Vector3.Forward());
        this.initialGrabPoint = new Vector3();

        this.hitDistance = -1;
        this.hovered = null;
        this.manipulating = null;

        // Babylon scene for picking
        this.babylonScene = null;

    }

    update() {

        const {
            ray,
            hovered,
            manipulating,
            scene,
        } = this;

        if (manipulating) {

            return;

        }

        let hoveredJoint = null;

        // Use Babylon.js scene picking with the ray
        if (this.babylonScene) {

            const pickResult = this.babylonScene.pickWithRay(ray, (mesh) => {

                // Check if this mesh is a descendant of the scene (URDF robot)
                let parent = mesh;
                while (parent) {

                    if (parent === scene) return true;
                    parent = parent.parent;

                }
                return false;

            });

            if (pickResult && pickResult.hit) {

                this.hitDistance = pickResult.distance;
                hoveredJoint = findNearestJoint(pickResult.pickedMesh);
                this.initialGrabPoint.copyFrom(pickResult.pickedPoint);

            }

        }

        if (hoveredJoint !== hovered) {

            if (hovered) {

                this.onUnhover(hovered);

            }

            this.hovered = hoveredJoint;

            if (hoveredJoint) {

                this.onHover(hoveredJoint);

            }

        }

    }

    updateJoint(joint, angle) {

        joint.setJointValue(angle);

    }

    onDragStart(joint) {

    }

    onDragEnd(joint) {

    }

    onHover(joint) {

    }

    onUnhover(joint) {

    }

    getRevoluteDelta(joint, startPoint, endPoint) {

        // set up the plane
        // Transform joint axis to world space
        const worldMatrix = joint.getWorldMatrix();
        Vector3.TransformNormalToRef(joint.axis, worldMatrix, tempVector);
        tempVector.normalize();

        // Get pivot point (joint origin in world space)
        Vector3.TransformCoordinatesToRef(Vector3.Zero(), worldMatrix, pivotPoint);

        setPlaneFromNormalAndPoint(tempVector, pivotPoint);

        // project the drag points onto the plane
        const pStart = projectPointOnPlane(planeNormal, planeD, startPoint);
        projectedStartPoint.copyFrom(pStart);
        const pEnd = projectPointOnPlane(planeNormal, planeD, endPoint);
        projectedEndPoint.copyFrom(pEnd);

        // get the directions relative to the pivot
        projectedStartPoint.subtractInPlace(pivotPoint);
        projectedEndPoint.subtractInPlace(pivotPoint);

        const cross = Vector3.Cross(projectedStartPoint, projectedEndPoint);

        const direction = Math.sign(Vector3.Dot(cross, planeNormal));
        const startNorm = projectedStartPoint.length();
        const endNorm = projectedEndPoint.length();
        if (startNorm === 0 || endNorm === 0) return 0;

        const cosAngle = Vector3.Dot(projectedStartPoint.normalize(), projectedEndPoint.normalize());
        return direction * Math.acos(Math.max(-1, Math.min(1, cosAngle)));

    }

    getPrismaticDelta(joint, startPoint, endPoint) {

        tempVector.copyFrom(endPoint).subtractInPlace(startPoint);

        // Transform joint axis to parent world space
        const parentWorldMatrix = joint.parent ? joint.parent.getWorldMatrix() : Matrix.Identity();
        const axisWorld = new Vector3();
        Vector3.TransformNormalToRef(joint.axis, parentWorldMatrix, axisWorld);
        axisWorld.normalize();

        return Vector3.Dot(tempVector, axisWorld);

    }

    moveRay(toRay) {

        const { ray, hitDistance, manipulating } = this;

        if (manipulating) {

            // ray.at(hitDistance) = ray.origin + ray.direction * hitDistance
            ray.origin.addToRef(ray.direction.scale(hitDistance), prevHitPoint);
            toRay.origin.addToRef(toRay.direction.scale(hitDistance), newHitPoint);

            let delta = 0;
            if (manipulating.jointType === 'revolute' || manipulating.jointType === 'continuous') {

                delta = this.getRevoluteDelta(manipulating, prevHitPoint, newHitPoint);

            } else if (manipulating.jointType === 'prismatic') {

                delta = this.getPrismaticDelta(manipulating, prevHitPoint, newHitPoint);

            }

            if (delta) {

                this.updateJoint(manipulating, manipulating.angle + delta);

            }

        }

        this.ray.origin.copyFrom(toRay.origin);
        this.ray.direction.copyFrom(toRay.direction);
        this.update();

    }

    setGrabbed(grabbed) {

        const { hovered, manipulating } = this;

        if (grabbed) {

            if (manipulating !== null || hovered === null) {

                return;

            }

            this.manipulating = hovered;
            this.onDragStart(hovered);

        } else {

            if (this.manipulating === null) {
                return;
            }

            this.onDragEnd(this.manipulating);
            this.manipulating = null;
            this.update();

        }

    }

}

export class PointerURDFDragControls extends URDFDragControls {

    constructor(scene, babylonScene, camera, domElement) {

        super(scene);
        this.babylonScene = babylonScene;
        this.camera = camera;
        this.domElement = domElement;

        const self = this;

        function updateRayFromMouse(e) {

            const rect = domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            // Convert to Babylon.js viewport coordinates (0 to width, 0 to height)
            const viewportX = (x + 1) / 2 * rect.width;
            const viewportY = (1 - y) / 2 * rect.height;

            // Create picking ray from camera through the screen point
            const pickRay = babylonScene.createPickingRay(
                viewportX, viewportY,
                Matrix.Identity(),
                camera,
            );

            return pickRay;

        }

        this._mouseDown = e => {

            const pickRay = updateRayFromMouse(e);
            self.moveRay(pickRay);
            self.setGrabbed(true);

        };

        this._mouseMove = e => {

            const pickRay = updateRayFromMouse(e);
            self.moveRay(pickRay);

        };

        this._mouseUp = e => {

            const pickRay = updateRayFromMouse(e);
            self.moveRay(pickRay);
            self.setGrabbed(false);

        };

        domElement.addEventListener('mousedown', this._mouseDown);
        domElement.addEventListener('mousemove', this._mouseMove);
        domElement.addEventListener('mouseup', this._mouseUp);

    }

    getRevoluteDelta(joint, startPoint, endPoint) {

        const { camera, initialGrabPoint } = this;

        // set up the plane
        const worldMatrix = joint.getWorldMatrix();
        Vector3.TransformNormalToRef(joint.axis, worldMatrix, tempVector);
        tempVector.normalize();

        Vector3.TransformCoordinatesToRef(Vector3.Zero(), worldMatrix, pivotPoint);

        setPlaneFromNormalAndPoint(tempVector, pivotPoint);

        const cameraDir = camera.position.subtract(initialGrabPoint).normalize();

        // if looking into the plane of rotation
        if (Math.abs(Vector3.Dot(cameraDir, planeNormal)) > 0.3) {

            return super.getRevoluteDelta(joint, startPoint, endPoint);

        } else {

            // get the up direction from camera world matrix
            const cameraWorldMatrix = camera.getWorldMatrix();
            Vector3.TransformNormalToRef(new Vector3(0, 1, 0), cameraWorldMatrix, tempVector);

            // get points projected onto the plane of rotation
            projectedStartPoint.copyFrom(projectPointOnPlane(planeNormal, planeD, startPoint));
            projectedEndPoint.copyFrom(projectPointOnPlane(planeNormal, planeD, endPoint));

            Vector3.TransformNormalToRef(new Vector3(0, 0, -1), cameraWorldMatrix, tempVector);
            const cross = Vector3.Cross(tempVector, planeNormal);
            tempVector2.copyFrom(endPoint).subtractInPlace(startPoint);

            return Vector3.Dot(cross, tempVector2);

        }

    }

    dispose() {

        const { domElement } = this;
        domElement.removeEventListener('mousedown', this._mouseDown);
        domElement.removeEventListener('mousemove', this._mouseMove);
        domElement.removeEventListener('mouseup', this._mouseUp);

    }

}
