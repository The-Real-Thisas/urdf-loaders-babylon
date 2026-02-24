import { StandardMaterial, Mesh } from '@babylonjs/core';
import URDFViewer from './urdf-viewer-element.js';
import { PointerURDFDragControls } from './URDFDragControls.js';

// urdf-manipulator element
// Displays a URDF model that can be manipulated with the mouse

// Events
// joint-mouseover: Fired when a joint is hovered over
// joint-mouseout: Fired when a joint is no longer hovered over
// manipulate-start: Fires when a joint is manipulated
// manipulate-end: Fires when a joint is done being manipulated
export default
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
        this.highlightMaterial = new StandardMaterial('highlightMat', this.scene);
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
                if (c instanceof Mesh) {

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
