import { TransformNode, Vector3, Scene, Nullable, Node } from '@babylonjs/core';

declare class URDFBase extends TransformNode {

    urdfNode: Element | null;
    urdfName: string;

    constructor(name?: string, scene?: Scene | null);
    traverse(callback: (node: URDFBase) => void): void;
    copy(source: URDFBase, recursive?: boolean): this;
    clone(name: string, newParent: Nullable<Node>, doNotCloneChildren?: boolean): Nullable<TransformNode>;

}

export class URDFCollider extends URDFBase {

    isURDFCollider: true;

}

export class URDFVisual extends URDFBase {

    isURDFVisual: true;

}

export class URDFLink extends URDFBase {

    isURDFLink: true;

}

export class URDFJoint extends URDFBase {

    isURDFJoint: true;

    urdfNode: Element | null;
    axis: Vector3;
    jointType: 'fixed' | 'continuous' | 'revolute' | 'planar' | 'prismatic' | 'floating';
    angle: number;
    jointValue: number[];
    limit: { lower: number, upper: number };
    ignoreLimits: boolean;
    mimicJoints: URDFMimicJoint[];

    origPosition: Vector3 | null;
    origQuaternion: import('@babylonjs/core').Quaternion | null;

    setJointValue(...values: (number | null)[]): boolean;

}

export class URDFMimicJoint extends URDFJoint {

    mimicJoint: string;
    offset: number;
    multiplier: number;

    updateFromMimickedJoint(...values: number[]): boolean;

}

export class URDFRobot extends URDFLink {

    isURDFRobot: true;

    urdfRobotNode: Element | null;
    robotName: string;

    links: { [ key: string ]: URDFLink };
    joints: { [ key: string ]: URDFJoint };
    colliders: { [ key: string ]: URDFCollider };
    visual: { [ key: string ]: URDFVisual };
    frames: { [ key: string ]: TransformNode };

    setJointValue(jointName: string, ...values: number[]): boolean;
    setJointValues(values: { [ key: string ]: number | number[] }): boolean;
    getFrame(name: string): TransformNode;

}
