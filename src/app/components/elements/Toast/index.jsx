import React from 'react';

export default class Toast extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <div className={`copy_toast ${this.props.showToast ? 'show' : ''}`}>
                {this.props.text}
            </div>
        );
    }
}
