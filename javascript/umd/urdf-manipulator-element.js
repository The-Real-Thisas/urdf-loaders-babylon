(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('@babylonjs/core'), require('./urdf-viewer-element.js')) :
    typeof define === 'function' && define.amd ? define(['@babylonjs/core', './urdf-viewer-element'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.URDFManipulator = factory(global.BABYLON, global.URDFViewer));
})(this, (function (core, URDFViewer) { 'use strict';

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

        const dist = core.Vector3.Dot(planeNormal, point) + planeD;
        return point.subtract(planeNormal.scale(dist));

    }

    const prevHitPoint = new core.Vector3();
    const newHitPoint = new core.Vector3();
    const pivotPoint = new core.Vector3();
    const tempVector = new core.Vector3();
    const tempVector2 = new core.Vector3();
    const projectedStartPoint = new core.Vector3();
    const projectedEndPoint = new core.Vector3();

    // Simple plane representation: normal + d (ax + by + cz + d = 0)
    let planeNormal = new core.Vector3();
    let planeD = 0;

    function setPlaneFromNormalAndPoint(normal, point) {

        planeNormal = normal.clone();
        planeD = -core.Vector3.Dot(normal, point);

    }

    class URDFDragControls {

        constructor(scene) {

            this.enabled = true;
            this.scene = scene;
            this.ray = new core.Ray(core.Vector3.Zero(), core.Vector3.Forward());
            this.initialGrabPoint = new core.Vector3();

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
            core.Vector3.TransformNormalToRef(joint.axis, worldMatrix, tempVector);
            tempVector.normalize();

            // Get pivot point (joint origin in world space)
            core.Vector3.TransformCoordinatesToRef(core.Vector3.Zero(), worldMatrix, pivotPoint);

            setPlaneFromNormalAndPoint(tempVector, pivotPoint);

            // project the drag points onto the plane
            const pStart = projectPointOnPlane(planeNormal, planeD, startPoint);
            projectedStartPoint.copyFrom(pStart);
            const pEnd = projectPointOnPlane(planeNormal, planeD, endPoint);
            projectedEndPoint.copyFrom(pEnd);

            // get the directions relative to the pivot
            projectedStartPoint.subtractInPlace(pivotPoint);
            projectedEndPoint.subtractInPlace(pivotPoint);

            const cross = core.Vector3.Cross(projectedStartPoint, projectedEndPoint);

            const direction = Math.sign(core.Vector3.Dot(cross, planeNormal));
            const startNorm = projectedStartPoint.length();
            const endNorm = projectedEndPoint.length();
            if (startNorm === 0 || endNorm === 0) return 0;

            const cosAngle = core.Vector3.Dot(projectedStartPoint.normalize(), projectedEndPoint.normalize());
            return direction * Math.acos(Math.max(-1, Math.min(1, cosAngle)));

        }

        getPrismaticDelta(joint, startPoint, endPoint) {

            tempVector.copyFrom(endPoint).subtractInPlace(startPoint);

            // Transform joint axis to parent world space
            const parentWorldMatrix = joint.parent ? joint.parent.getWorldMatrix() : core.Matrix.Identity();
            const axisWorld = new core.Vector3();
            core.Vector3.TransformNormalToRef(joint.axis, parentWorldMatrix, axisWorld);
            axisWorld.normalize();

            return core.Vector3.Dot(tempVector, axisWorld);

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

    class PointerURDFDragControls extends URDFDragControls {

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
                    core.Matrix.Identity(),
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
            core.Vector3.TransformNormalToRef(joint.axis, worldMatrix, tempVector);
            tempVector.normalize();

            core.Vector3.TransformCoordinatesToRef(core.Vector3.Zero(), worldMatrix, pivotPoint);

            setPlaneFromNormalAndPoint(tempVector, pivotPoint);

            const cameraDir = camera.position.subtract(initialGrabPoint).normalize();

            // if looking into the plane of rotation
            if (Math.abs(core.Vector3.Dot(cameraDir, planeNormal)) > 0.3) {

                return super.getRevoluteDelta(joint, startPoint, endPoint);

            } else {

                // get the up direction from camera world matrix
                const cameraWorldMatrix = camera.getWorldMatrix();
                core.Vector3.TransformNormalToRef(new core.Vector3(0, 1, 0), cameraWorldMatrix, tempVector);

                // get points projected onto the plane of rotation
                projectedStartPoint.copyFrom(projectPointOnPlane(planeNormal, planeD, startPoint));
                projectedEndPoint.copyFrom(projectPointOnPlane(planeNormal, planeD, endPoint));

                core.Vector3.TransformNormalToRef(new core.Vector3(0, 0, -1), cameraWorldMatrix, tempVector);
                const cross = core.Vector3.Cross(tempVector, planeNormal);
                tempVector2.copyFrom(endPoint).subtractInPlace(startPoint);

                return core.Vector3.Dot(cross, tempVector2);

            }

        }

        dispose() {

            const { domElement } = this;
            domElement.removeEventListener('mousedown', this._mouseDown);
            domElement.removeEventListener('mousemove', this._mouseMove);
            domElement.removeEventListener('mouseup', this._mouseUp);

        }

    }

    // urdf-manipulator element
    // Displays a URDF model that can be manipulated with the mouse

    // Events
    // joint-mouseover: Fired when a joint is hovered over
    // joint-mouseout: Fired when a joint is no longer hovered over
    // manipulate-start: Fires when a joint is manipulated
    // manipulate-end: Fires when a joint is done being manipulated
    class URDFManipulator extends URDFViewer {

        static get observedAttributes() {

            return ['highlight-color', ...super.observedAttributes];

        }

        get disableDragging() { return this.hasAttribute('disable-dragging'); }
        set disableDragging(val) { val ? this.setAttribute('disable-dragging', !!val) : this.removeAttribute('disable-dragging'); }

        get highlightColor() { return this.getAttribute('highlight-color') || '#FFFFFF'; }
        set highlightColor(val) { val ? this.setAttribute('highlight-color', val) : this.removeAttribute('highlight-color'); }

        constructor(...args) {

            super(...args);

            // The highlight material
            this.highlightMaterial = new core.StandardMaterial('highlightMat', this.scene);
            const hlColor = this._parseColor(this.highlightColor);
            this.highlightMaterial.diffuseColor = hlColor;
            this.highlightMaterial.emissiveColor = hlColor.scale(0.25);
            this.highlightMaterial.specularPower = 10;

            const isJoint = j => {

                return j.isURDFJoint && j.jointType !== 'fixed';

            };

            // Highlight the link geometry under a joint
            const highlightLinkGeometry = (m, revert) => {

                const traverse = c => {

                    // Set or revert the highlight color
                    if (c instanceof core.Mesh) {

                        if (revert) {

                            c.material = c.__origMaterial;
                            delete c.__origMaterial;

                        } else {

                            c.__origMaterial = c.material;
                            c.material = this.highlightMaterial;

                        }

                    }

                    // Look into the children and stop if the next child is
                    // another joint
                    if (c === m || !isJoint(c)) {

                        const children = c.getChildren ? c.getChildren() : [];
                        for (let i = 0; i < children.length; i++) {

                            const child = children[i];
                            if (!child.isURDFCollider) {

                                traverse(child);

                            }

                        }

                    }

                };

                traverse(m);

            };

            const el = this._canvas;

            const dragControls = new PointerURDFDragControls(this.scene, this.babylonScene, this.camera, el);
            dragControls.onDragStart = joint => {

                this.dispatchEvent(new CustomEvent('manipulate-start', { bubbles: true, cancelable: true, detail: joint.name }));
                this.camera.detachControl();
                this.redraw();

            };
            dragControls.onDragEnd = joint => {

                this.dispatchEvent(new CustomEvent('manipulate-end', { bubbles: true, cancelable: true, detail: joint.name }));
                this.camera.attachControl(this._canvas, true);
                this.redraw();

            };
            dragControls.updateJoint = (joint, angle) => {

                this.setJointValue(joint.name, angle);

            };
            dragControls.onHover = joint => {

                highlightLinkGeometry(joint, false);
                this.dispatchEvent(new CustomEvent('joint-mouseover', { bubbles: true, cancelable: true, detail: joint.name }));
                this.redraw();

            };
            dragControls.onUnhover = joint => {

                highlightLinkGeometry(joint, true);
                this.dispatchEvent(new CustomEvent('joint-mouseout', { bubbles: true, cancelable: true, detail: joint.name }));
                this.redraw();

            };

            this.dragControls = dragControls;

        }

        disconnectedCallback() {

            super.disconnectedCallback();
            this.dragControls.dispose();

        }

        attributeChangedCallback(attr, oldval, newval) {

            super.attributeChangedCallback(attr, oldval, newval);

            switch (attr) {

                case 'highlight-color': {

                    const hlColor = this._parseColor(this.highlightColor);
                    this.highlightMaterial.diffuseColor = hlColor;
                    this.highlightMaterial.emissiveColor = hlColor.scale(0.25);
                    break;

                }

            }

        }

    }

    return URDFManipulator;

}));
//# sourceMappingURL=urdf-manipulator-element.js.map
