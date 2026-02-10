export interface Listing {
    listing_id: string; // Document ID = Etsy listing ID
    account_id: string; // Reference to account
    title: string;
    image: string;
    url: string;
    createdAt: Date; // Lần đầu phát hiện listing
    updatedAt: Date; // Mỗi khi có thay đổi (title, image, status)
    status: 'active' | 'inactive'; // Toggle status, không xóa
}
