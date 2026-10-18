// EZ-Tree MIT skeleton adapter; upstream pin and licence in ./ez-tree/.
// No textures, preset JSON, wind or opaque leaf quads. Species supply leaf anatomy.
import {Tree} from './ez-tree/tree.js';
import Options from './ez-tree/options.js';
export function makeBranching({seed=1,levels=2,lengths=[.42,.28,.16,.08],radii=[.012,.55,.5,.4],children=[5,3,2],angles=[0,48,40,35],starts=[0,.25,.2,.2],gnarliness=[.0005,.001,.0015,.001],leafCount=3}={}) {
 const o=new Options();o.seed=seed;o.branch.levels=levels;o.branch.force.strength=0;
 for(let i=0;i<=3;i++){o.branch.length[i]=lengths[i]??.08;o.branch.radius[i]=radii[i]??.4;o.branch.children[i]=children[i]??0;o.branch.angle[i]=angles[i]??40;o.branch.start[i]=starts[i]??.2;o.branch.gnarliness[i]=gnarliness[i]??.001;o.branch.sections[i]=i===0?6:4;o.branch.segments[i]=i===0?5:3;o.branch.taper[i]=.65;o.branch.twist[i]=0;}
 o.leaves.count=leafCount;o.leaves.size=.05;o.leaves.sizeVariance=.2;o.leaves.start=.12;
 const t=new Tree(o);const result=t.createGeometry();result.leaves.dispose();t.branchesMesh.geometry.dispose();t.leavesMesh.geometry.dispose();t.branchesMesh.material.dispose();t.leavesMesh.material.dispose();
 return {geometry:result.branches,branches:t.skeleton.branches,sites:t.skeleton.leaves};
}
