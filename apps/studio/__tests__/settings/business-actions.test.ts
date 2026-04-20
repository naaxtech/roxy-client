jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/business', () => ({ getOwnedBusiness: jest.fn(), getOwnedBusinessFull: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server');
const { getOwnedBusiness } = jest.requireMock('@/lib/business');

describe('updateBusiness', () => {
  it('throws if no business', async () => {
    getOwnedBusiness.mockResolvedValue(null);
    const { updateBusiness } = await import('@/app/(dashboard)/settings/business-actions');
    const fd = new FormData();
    fd.set('name', 'Test');
    await expect(updateBusiness('biz-1', fd)).rejects.toThrow('No business found');
  });

  it('updates and clears rejection reason', async () => {
    getOwnedBusiness.mockResolvedValue({ id: 'biz-1' });
    const mockEq2 = jest.fn().mockResolvedValue({ error: null });
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
    createClient.mockResolvedValue({ from: jest.fn(() => ({ update: mockUpdate })) });
    const { updateBusiness } = await import('@/app/(dashboard)/settings/business-actions');
    const fd = new FormData();
    fd.set('name', 'Updated Name');
    await updateBusiness('biz-1', fd);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Name', business_rejection_reason: null }));
  });
});

describe('resubmitBusiness', () => {
  it('clears rejection reason for own business', async () => {
    getOwnedBusiness.mockResolvedValue({ id: 'biz-1' });
    const mockEq2 = jest.fn().mockResolvedValue({ error: null });
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
    createClient.mockResolvedValue({ from: jest.fn(() => ({ update: mockUpdate })) });
    const { resubmitBusiness } = await import('@/app/(dashboard)/settings/business-actions');
    await resubmitBusiness('biz-1');
    expect(mockUpdate).toHaveBeenCalledWith({ business_rejection_reason: null });
  });
});
