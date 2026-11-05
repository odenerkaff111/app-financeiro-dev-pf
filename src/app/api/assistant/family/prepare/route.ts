import {prepareRegistrar} from '@/lib/registrar';
export const runtime='nodejs';
export const maxDuration=90;
export async function POST(request:Request){return prepareRegistrar(request);}
