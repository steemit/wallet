/* eslint-disable linebreak-style */
/* eslint react/prop-types: 0 */
import React, { Component } from 'react';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { LEFT_PAGE, RIGHT_PAGE } from './constants'
/**
 * Helper method for creating a range of numbers
 * range(1, 5) => [1, 2, 3, 4, 5]
 */
const range = (from, to, step = 1) => {
    let i = from;
    const rng = [];
    while (i <= to) {
        rng.push(i);
        i += step;
    }
    return rng;
}

class Pagination extends Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Pagination');
        const { totalRecords = null, pageLimit = 100, pageNeighbours = 0 } = props;
        this.pageLimit = typeof pageLimit === 'number' ? pageLimit : 100;
        this.totalRecords = typeof totalRecords === 'number' ? totalRecords : 0;
        // pageNeighbours can be: 0, 1 or 2
        this.pageNeighbours = typeof pageNeighbours === 'number'
            ? Math.max(0, Math.min(pageNeighbours, 2))
            : 0;
        this.totalPages = Math.ceil(this.totalRecords / this.pageLimit);
        this.state = { currentPage: 1 };
    }

    componentDidMount() {
        this.gotoPage(1);
    }

    gotoPage = page => {
        const { onPageChanged = f => f } = this.props;
        const currentPage = Math.max(0, Math.min(page, this.totalPages));
        const paginationData = {
            currentPage,
        };

        this.setState({ currentPage }, () => onPageChanged(paginationData));
    }

    handleClick = page => evt => {
        evt.preventDefault();
        this.gotoPage(page);
    }

    handleMoveLeft = evt => {
        evt.preventDefault();
        this.gotoPage(this.state.currentPage - (this.pageNeighbours * 2) - 1);
    }

    handleMoveRight = evt => {
        evt.preventDefault();
        this.gotoPage(this.state.currentPage + (this.pageNeighbours * 2) + 1);
    }

    render() {
        const {
            totalRecords,
            pageLimit
        } = this.props
        /**
         * Let's say we have 10 pages and we set pageNeighbours to 2
         * Given that the current page is 6
         * The pagination control will look like the following:
         *
         * (1) < {4 5} [6] {7 8} > (10)
         *
         * (x) => terminal pages: first and last page(always visible)
         * [x] => represents current page
         * {...x} => represents page neighbours
         */
        const fetchPageNumbers = () => {
            this.totalPages = Math.ceil(totalRecords / pageLimit);
            const totalPages = this.totalPages;
            const currentPage = this.state.currentPage;
            const pageNeighbours = this.pageNeighbours;
            /**
             * totalNumbers: the total page numbers to show on the control
             * totalBlocks: totalNumbers + 2 to cover for the left(<) and right(>) controls
             */
            const totalNumbers = (this.pageNeighbours * 2) + 3;
            const totalBlocks = totalNumbers + 2;
            if (totalPages > totalBlocks) {
                const startPage = Math.max(2, currentPage - pageNeighbours);
                const endPage = Math.min(totalPages - 1, currentPage + pageNeighbours);
                let pages = range(startPage, endPage);
                /**
                 * hasLeftSpill: has hidden pages to the left
                 * hasRightSpill: has hidden pages to the right
                 * spillOffset: number of hidden pages either to the left or to the right
                 */
                const hasLeftSpill = startPage > 2;
                const hasRightSpill = (totalPages - endPage) > 1;
                const spillOffset = totalNumbers - (pages.length + 1);
                switch (true) {
                    // handle: (1) < {5 6} [7] {8 9} (10)
                    case (hasLeftSpill && !hasRightSpill): {
                        const extraPages = range(startPage - spillOffset, startPage - 1);
                        pages = [LEFT_PAGE, ...extraPages, ...pages];
                        break;
                    }
                    // handle: (1) {2 3} [4] {5 6} > (10)
                    case (!hasLeftSpill && hasRightSpill): {
                        const extraPages = range(endPage + 1, endPage + spillOffset);
                        pages = [...pages, ...extraPages, RIGHT_PAGE];
                        break;
                    }
                    // handle: (1) < {4 5} [6] {7 8} > (10)
                    case (hasLeftSpill && hasRightSpill):
                    default: {
                        pages = [LEFT_PAGE, ...pages, RIGHT_PAGE];
                        break;
                    }
                }
                return [1, ...pages, totalPages];
            }
            return range(1, totalPages);
        }
        if (!totalRecords || this.totalPages === 1) return null;

        const { currentPage } = this.state;
        const pages = fetchPageNumbers();

        return (
            <nav className="navPagination">
                <ul className="Pagination">
                    {pages.map((page, index) => {

                        if (page === LEFT_PAGE) return (
                            <li key={`${LEFT_PAGE}-${index}`} className="page-item">
                                <button className="page-link text--capitalize" aria-label="Previous" onClick={this.handleMoveLeft}>
                                    <span aria-hidden="true">&laquo;</span>
                                    <span className="sr-only">Previous</span>
                                </button>
                            </li>
                        );

                        if (page === RIGHT_PAGE) return (
                            <li key={`${RIGHT_PAGE}-${index}`} className="page-item">
                                <button className="page-link text--capitalize" aria-label="Next" onClick={this.handleMoveRight}>
                                    <span aria-hidden="true">&raquo;</span>
                                    <span className="sr-only">Next</span>
                                </button>
                            </li>
                        );
                        return (
                            <li key={`pagenumber-${index}`} className={`page-item${currentPage === page ? ' active' : ''}`}>
                                <button className="page-link" onClick={this.handleClick(page)}>{page}</button>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        );
    }
}
export default Pagination;